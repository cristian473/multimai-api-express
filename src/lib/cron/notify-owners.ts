import { db } from '../db/firebase';
import { sendOwnerReminder, generateOwnerCompletionMessage } from '../whatsapp/send-reminder';
import { Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';

/**
 * Ensures an owner token exists for viewing receipts
 */
async function ensureOwnerToken(
  uid: string,
  tenantId: string,
  reminderId: string,
  ownerPhone: string,
  ownerName: string,
  currentToken?: string
): Promise<string> {
  // Check if current token is still valid
  if (currentToken) {
    const tokenSnapshot = await db
      .collection(`users/${uid}/tenants/${tenantId}/ownerTokens`)
      .where('token', '==', currentToken)
      .limit(1)
      .get();

    if (!tokenSnapshot.empty) {
      const tokenData = tokenSnapshot.docs[0].data();
      const expiresAt = tokenData.expiresAt?.toDate?.() || new Date(tokenData.expiresAt);
      if (expiresAt > new Date()) {
        return currentToken;
      }
    }
  }

  // Generate new token
  const token = nanoid(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days for viewing receipts

  const tokenData = {
    token,
    reminderId,
    tenantId,
    ownerPhone,
    ownerName,
    expiresAt: Timestamp.fromDate(expiresAt),
    createdAt: Timestamp.fromDate(now),
    type: 'receipts_view', // Mark as receipts view token
  };

  await db.doc(`users/${uid}/tenants/${tenantId}/ownerTokens/${token}`).set(tokenData);

  // Update reminder with new token
  await db.doc(`users/${uid}/tenants/${tenantId}/reminders/${reminderId}`).update({
    currentOwnerToken: token,
    updated_at: Timestamp.fromDate(now),
  });

  return token;
}

interface ReminderData {
  id: string;
  uid: string;
  tenantId: string;
  tenantName: string;
  ownerPhone: string;
  ownerName: string;
  reminderName?: string;
  payment_types: string[];
  custom_payment_types?: string[];
  receiptsStatus: Record<string, boolean>;
  status: string;
  notified_owner: boolean;
  currentOwnerToken?: string;
}

/**
 * Processes a reminder and sends notification to owner if all receipts are complete
 */
async function processReminder(reminder: ReminderData, session: string): Promise<boolean> {
  try {
    console.log(`[notifyOwners] Processing reminder ${reminder.id} for tenant ${reminder.tenantName}`);

    // Verify reminder is completed
    if (reminder.status !== 'completed') {
      console.log(`[notifyOwners] Reminder ${reminder.id} is not completed (status: ${reminder.status})`);
      return true; // Skip but don't mark as failed
    }

    // Verify owner hasn't been notified yet
    if (reminder.notified_owner) {
      console.log(`[notifyOwners] Owner already notified for reminder ${reminder.id}`);
      return true; // Skip but don't mark as failed
    }

    // Verify owner phone exists
    if (!reminder.ownerPhone) {
      console.log(`[notifyOwners] No owner phone for reminder ${reminder.id}`);
      return true; // Skip but don't mark as failed
    }

    // Get all payment types
    const allTypes = [
      ...reminder.payment_types,
      ...(reminder.custom_payment_types || [])
    ];

    // Verify all receipts are complete
    const receiptsStatus = reminder.receiptsStatus || {};
    const allComplete = allTypes.every(type => receiptsStatus[type] === true);

    if (!allComplete) {
      console.log(`[notifyOwners] Not all receipts are complete for reminder ${reminder.id}`);
      return true; // Skip but don't mark as failed
    }

    // Generate or reuse owner token for receipts viewing
    const token = await ensureOwnerToken(
      reminder.uid,
      reminder.tenantId,
      reminder.id,
      reminder.ownerPhone,
      reminder.ownerName,
      reminder.currentOwnerToken
    );

    // Generate public link for owner to view receipts
    const baseUrl = process.env.ADMIN_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const receiptsLink = `${baseUrl}/owner/receipts/${token}`;

    // Generate message for owner
    const message = generateOwnerCompletionMessage(
      reminder.ownerName,
      reminder.tenantName,
      allTypes,
      reminder.reminderName,
      receiptsLink
    );

    // Send WhatsApp to owner
    const result = await sendOwnerReminder(session, reminder.ownerPhone, message);

    if (!result.success) {
      console.error(`[notifyOwners] Failed to send WhatsApp to owner ${reminder.ownerPhone}:`, result.error);
      return false;
    }

    // Mark as notified
    const now = new Date();
    await db
      .doc(`users/${reminder.uid}/tenants/${reminder.tenantId}/reminders/${reminder.id}`)
      .update({
        notified_owner: true,
        notified_owner_at: Timestamp.fromDate(now),
        updated_at: Timestamp.fromDate(now),
      });

    console.log(`[notifyOwners] Successfully notified owner for reminder ${reminder.id}`);
    return true;
  } catch (error) {
    console.error(`[notifyOwners] Error processing reminder ${reminder.id}:`, error);
    return false;
  }
}

/**
 * Processes all completed reminders and notifies owners
 */
export async function notifyOwnersOnCompletion(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const stats = {
    processed: 0,
    succeeded: 0,
    failed: 0,
  };

  try {
    console.log('[notifyOwnersOnCompletion] Starting owner notification cron job');

    const session = process.env.MULTIMAI_WS_SESSION || '';
    if (!session) {
      console.error('[notifyOwnersOnCompletion] MULTIMAI_WS_SESSION not configured');
      return stats;
    }

    // Get all users
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;

      // Get all active tenants
      const tenantsSnapshot = await db
        .collection(`users/${uid}/tenants`)
        .where('activo', '==', true)
        .get();

      for (const tenantDoc of tenantsSnapshot.docs) {
        const tenantId = tenantDoc.id;
        const tenantData = tenantDoc.data();

        // Get reminders with status 'completed' and notified_owner = false
        const remindersSnapshot = await db
          .collection(`users/${uid}/tenants/${tenantId}/reminders`)
          .where('status', '==', 'completed')
          .where('notified_owner', '==', false)
          .get();

        for (const reminderDoc of remindersSnapshot.docs) {
          const reminderData = reminderDoc.data();

          // Get all payment types
          const allTypes = [
            ...(reminderData.payment_types || []),
            ...(reminderData.custom_payment_types || [])
          ];

          // Verify all receipts are complete
          const receiptsStatus = reminderData.receiptsStatus || {};
          const allComplete = allTypes.every(type => receiptsStatus[type] === true);

          if (!allComplete) {
            console.log(`[notifyOwnersOnCompletion] Skipping reminder ${reminderDoc.id} - not all receipts complete`);
            continue;
          }

          // Prepare reminder data
          const reminder: ReminderData = {
            id: reminderDoc.id,
            uid,
            tenantId,
            tenantName: `${tenantData.nombre} ${tenantData.apellido}`,
            ownerPhone: tenantData.dueno_telefono || '',
            ownerName: tenantData.dueno_nombre || 'propietario',
            reminderName: reminderData.name,
            payment_types: reminderData.payment_types || [],
            custom_payment_types: reminderData.custom_payment_types,
            receiptsStatus: reminderData.receiptsStatus || {},
            status: reminderData.status || 'pending',
            notified_owner: reminderData.notified_owner || false,
            currentOwnerToken: reminderData.currentOwnerToken,
          };

          // Skip if no owner phone
          if (!reminder.ownerPhone) {
            console.log(`[notifyOwnersOnCompletion] Skipping reminder ${reminderDoc.id} - no owner phone`);
            continue;
          }

          stats.processed++;

          const success = await processReminder(reminder, session);
          if (success) {
            stats.succeeded++;
          } else {
            stats.failed++;
          }
        }
      }
    }

    console.log('[notifyOwnersOnCompletion] Cron job completed:', stats);
    return stats;
  } catch (error) {
    console.error('[notifyOwnersOnCompletion] Fatal error:', error);
    return stats;
  }
}

