import { db } from '../db/firebase';
import { sendOwnerReminder, sendTenantBillsAvailable, generateOwnerReminderMessage, generateBillsAvailableMessage } from '../whatsapp/send-reminder';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';

/**
 * Removes undefined values from an object (Firestore doesn't accept undefined)
 */
function removeUndefined<T extends Record<string, any>>(obj: T): T {
  const result: any = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) {
      if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && !(obj[key] instanceof Date) && !(obj[key] instanceof Timestamp)) {
        result[key] = removeUndefined(obj[key]);
      } else {
        result[key] = obj[key];
      }
    }
  }
  return result as T;
}

interface PaymentTypeConfig {
  id: string;
  name: string;
  requiresOwnerBill: boolean;
  ownerReminderDate?: Date;
  ownerReminderTime?: string;
  ownerReminderInterval?: number;
  ownerBill?: {
    url: string;
    amount: number;
    uploadedAt: Date;
    lockedAt?: Date;
    locked: boolean;
  };
  ownerLastRemindedAt?: Date;
  ownerReminderCount?: number;
}

interface OwnerReminderData {
  id: string;
  uid: string;
  tenantId: string;
  tenantName: string;
  ownerPhone: string;
  ownerName: string;
  reminderName?: string;
  paymentTypeConfigs: PaymentTypeConfig[];
  currentOwnerToken?: string;
}

/**
 * Generates or reuses an owner token for the reminder
 */
async function ensureOwnerToken(
  uid: string,
  tenantId: string,
  reminderId: string,
  ownerPhone: string,
  ownerName: string,
  currentToken?: string
): Promise<string> {
  if (currentToken) {
    const tokenSnapshot = await db
      .collection(`users/${uid}/tenants/${tenantId}/ownerTokens`)
      .where('token', '==', currentToken)
      .limit(1)
      .get();

    if (!tokenSnapshot.empty) {
      const tokenData = tokenSnapshot.docs[0].data();
      const expiresAt = tokenData.expiresAt.toDate();
      if (expiresAt > new Date()) {
        return currentToken;
      }
    }
  }

  const token = nanoid(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const tokenData = {
    token,
    reminderId,
    tenantId,
    ownerPhone,
    ownerName,
    expiresAt: Timestamp.fromDate(expiresAt),
    createdAt: Timestamp.fromDate(now),
  };

  await db.doc(`users/${uid}/tenants/${tenantId}/ownerTokens/${token}`).set(tokenData);
  await db.doc(`users/${uid}/tenants/${tenantId}/reminders/${reminderId}`).update({
    currentOwnerToken: token,
    updated_at: Timestamp.fromDate(now),
  });

  return token;
}

/**
 * Processes owner reminders - sends reminders to owners to upload bills
 */
async function processOwnerReminder(data: OwnerReminderData, session: string): Promise<boolean> {
  try {
    const pendingTypes = data.paymentTypeConfigs.filter(
      (config) => config.requiresOwnerBill && !config.ownerBill?.url
    );

    if (pendingTypes.length === 0) {
      return true; // Nothing to remind about
    }

    const token = await ensureOwnerToken(
      data.uid,
      data.tenantId,
      data.id,
      data.ownerPhone,
      data.ownerName,
      data.currentOwnerToken
    );

    const baseUrl = process.env.ADMIN_BASE_URL || 'http://localhost:3000';
    const portalLink = `${baseUrl}/owner/${token}`;

    const message = generateOwnerReminderMessage(
      data.ownerName,
      data.tenantName,
      pendingTypes.map((t) => t.name),
      portalLink,
      data.reminderName
    );

    const result = await sendOwnerReminder(session, data.ownerPhone, message);

    if (!result.success) {
      console.error(`[processOwnerReminder] Failed to send WhatsApp to owner ${data.ownerPhone}:`, result.error);
      return false;
    }

    const now = new Date();
    const paymentTypeConfigs = data.paymentTypeConfigs.map((config) => {
      if (config.requiresOwnerBill && !config.ownerBill?.url) {
        return removeUndefined({ ...config, ownerLastRemindedAt: now, ownerReminderCount: (config.ownerReminderCount || 0) + 1 });
      }
      return removeUndefined(config);
    });

    await db.doc(`users/${data.uid}/tenants/${data.tenantId}/reminders/${data.id}`).update({
      paymentTypeConfigs,
      owner_lastSentAt: Timestamp.fromDate(now),
      owner_sentCount: FieldValue.increment(1),
      updated_at: Timestamp.fromDate(now),
    });

    return true;
  } catch (error) {
    console.error(`[processOwnerReminder] Error:`, error);
    return false;
  }
}

/**
 * Locks owner bills after 24 hours and notifies tenants
 */
async function lockBillsAndNotifyTenants(session: string): Promise<{ locked: number; notified: number }> {
  const stats = { locked: 0, notified: 0 };

  try {
    const now = new Date();
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;
      const tenantsSnapshot = await db.collection(`users/${uid}/tenants`).where('activo', '==', true).get();

      for (const tenantDoc of tenantsSnapshot.docs) {
        const tenantId = tenantDoc.id;
        const tenantData = tenantDoc.data();
        const remindersSnapshot = await db.collection(`users/${uid}/tenants/${tenantId}/reminders`).where('active', '==', true).get();

        for (const reminderDoc of remindersSnapshot.docs) {
          const reminderData = reminderDoc.data();
          if (reminderData.status === 'completed') continue;

          const paymentTypeConfigs = reminderData.paymentTypeConfigs || [];
          const typesToLock: string[] = [];
          let updated = false;

          for (let i = 0; i < paymentTypeConfigs.length; i++) {
            const config = paymentTypeConfigs[i];
            if (config.requiresOwnerBill && config.ownerBill?.url && !config.ownerBill?.locked) {
              const uploadedAt = config.ownerBill.uploadedAt?.toDate?.() || new Date(config.ownerBill.uploadedAt);
              const hoursSinceUpload = (now.getTime() - uploadedAt.getTime()) / (1000 * 60 * 60);
              if (hoursSinceUpload >= 24) {
                paymentTypeConfigs[i].ownerBill.locked = true;
                paymentTypeConfigs[i].ownerBill.lockedAt = Timestamp.fromDate(now);
                typesToLock.push(config.name);
                updated = true;
                stats.locked++;
              }
            }
          }

          if (updated) {
            const cleanedConfigs = paymentTypeConfigs.map((c: any) => removeUndefined(c));
            await db.doc(`users/${uid}/tenants/${tenantId}/reminders/${reminderDoc.id}`).update({
              paymentTypeConfigs: cleanedConfigs,
              updated_at: Timestamp.fromDate(now),
            });

            if (tenantData.telefono && typesToLock.length > 0) {
              const token = reminderData.currentToken;
              if (token) {
                const baseUrl = process.env.ADMIN_BASE_URL || 'http://localhost:3000';
                const portalLink = `${baseUrl}/inquilinos/${token}`;

                const lockedConfigs = paymentTypeConfigs.filter((c: any) => typesToLock.includes(c.name));
                const message = generateBillsAvailableMessage(
                  `${tenantData.nombre} ${tenantData.apellido}`,
                  lockedConfigs.map((c: any) => ({ name: c.name, amount: c.ownerBill?.amount || 0, currency: c.currency || 'ARS' })),
                  portalLink,
                  reminderData.name
                );

                const result = await sendTenantBillsAvailable(session, tenantData.telefono, message);
                if (result.success) stats.notified++;
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[lockBillsAndNotifyTenants] Error:', error);
  }

  return stats;
}

/**
 * Main function to process all owner reminders
 */
export async function processOwnerReminders(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  locked: number;
  notified: number;
}> {
  const stats = { processed: 0, succeeded: 0, failed: 0, locked: 0, notified: 0 };

  try {
    console.log('[processOwnerReminders] Starting owner reminders cron job');

    const session = process.env.MULTIMAI_WS_SESSION || '';
    if (!session) {
      console.error('[processOwnerReminders] MULTIMAI_WS_SESSION not configured');
      return stats;
    }

    const now = new Date();
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;
      const tenantsSnapshot = await db.collection(`users/${uid}/tenants`).where('activo', '==', true).get();

      for (const tenantDoc of tenantsSnapshot.docs) {
        const tenantId = tenantDoc.id;
        const tenantData = tenantDoc.data();
        const remindersSnapshot = await db.collection(`users/${uid}/tenants/${tenantId}/reminders`).where('active', '==', true).get();

        for (const reminderDoc of remindersSnapshot.docs) {
          const reminderData = reminderDoc.data();
          if (reminderData.status === 'completed') continue;

          const paymentTypeConfigs = (reminderData.paymentTypeConfigs || []).map((c: any) => ({
            ...c,
            ownerReminderDate: c.ownerReminderDate?.toDate?.() || (c.ownerReminderDate ? new Date(c.ownerReminderDate) : undefined),
            ownerLastRemindedAt: c.ownerLastRemindedAt?.toDate?.() || (c.ownerLastRemindedAt ? new Date(c.ownerLastRemindedAt) : undefined),
            ownerBill: c.ownerBill ? {
              ...c.ownerBill,
              uploadedAt: c.ownerBill.uploadedAt?.toDate?.() || (c.ownerBill.uploadedAt ? new Date(c.ownerBill.uploadedAt) : undefined),
            } : undefined,
          }));

          const typesNeedingReminder = paymentTypeConfigs.filter((config: PaymentTypeConfig) => {
            if (!config.requiresOwnerBill || config.ownerBill?.url) return false;
            if (!config.ownerReminderDate) return false;
            if (config.ownerReminderDate > now) return false;

            if (config.ownerLastRemindedAt && config.ownerReminderInterval) {
              const daysSinceLast = (now.getTime() - config.ownerLastRemindedAt.getTime()) / (1000 * 60 * 60 * 24);
              return daysSinceLast >= config.ownerReminderInterval;
            }

            return !config.ownerLastRemindedAt;
          });

          if (typesNeedingReminder.length === 0) continue;

          stats.processed++;

          const reminderDataForOwner: OwnerReminderData = {
            id: reminderDoc.id,
            uid,
            tenantId,
            tenantName: `${tenantData.nombre} ${tenantData.apellido}`,
            ownerPhone: tenantData.dueno_telefono,
            ownerName: tenantData.dueno_nombre,
            reminderName: reminderData.name,
            paymentTypeConfigs,
            currentOwnerToken: reminderData.currentOwnerToken,
          };

          const success = await processOwnerReminder(reminderDataForOwner, session);
          if (success) stats.succeeded++;
          else stats.failed++;
        }
      }
    }

    // Lock bills after 24 hours and notify tenants
    const lockStats = await lockBillsAndNotifyTenants(session);
    stats.locked = lockStats.locked;
    stats.notified = lockStats.notified;

    console.log('[processOwnerReminders] Cron job completed:', stats);
    return stats;
  } catch (error) {
    console.error('[processOwnerReminders] Fatal error:', error);
    return stats;
  }
}

