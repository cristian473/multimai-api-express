import { db } from '../db/firebase';
import { sendPaymentReminder, generateReminderMessage, generateReminderMessageWithConfigs } from '../whatsapp/send-reminder';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';

interface PaymentTypeConfig {
  id: string;
  name: string;
  amount?: number;
  currency: string;
  accountHolder?: string;
  accountNumber?: string;
  cbuAlias?: string;
  requiresOwnerBill: boolean;
  ownerBill?: {
    url: string;
    amount: number;
    locked: boolean;
    uploadedAt: Date;
  };
}

interface ReminderData {
  id: string;
  uid: string;
  tenantId: string;
  tenantName: string;
  tenantPhone: string;
  reminderName?: string;
  payment_types: string[];
  custom_payment_types?: string[];
  paymentTypeConfigs?: PaymentTypeConfig[];
  receiptsStatus: Record<string, boolean>;
  status: string;
  frequency: 'weekly' | 'monthly' | 'bimonthly' | 'custom';
  custom_frequency_days?: number;
  reminder_interval_days?: number;
  nextReminderDate: Date;
  sentCount: number;
  currentToken?: string;
}

/**
 * Calcula la próxima fecha de recordatorio
 * Usa reminder_interval_days si está disponible, sino usa frequency
 */
function calculateNextReminderDate(reminderIntervalDays?: number, frequency?: string, customDays?: number): Date {
  const nextDate = new Date();

  // Priorizar reminder_interval_days
  if (reminderIntervalDays && reminderIntervalDays > 0) {
    nextDate.setDate(nextDate.getDate() + reminderIntervalDays);
    return nextDate;
  }

  // Fallback a frequency (retrocompatibilidad)
  switch (frequency) {
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case 'monthly':
      nextDate.setDate(nextDate.getDate() + 30);
      break;
    case 'bimonthly':
      nextDate.setDate(nextDate.getDate() + 60);
      break;
    case 'custom':
      if (customDays) {
        nextDate.setDate(nextDate.getDate() + customDays);
      }
      break;
    default:
      // Default: 7 días
      nextDate.setDate(nextDate.getDate() + 7);
  }

  return nextDate;
}

/**
 * Genera o reutiliza un token para el reminder
 */
async function ensureReminderToken(
  uid: string,
  tenantId: string,
  reminderId: string,
  currentToken?: string
): Promise<string> {
  // Si ya existe un token válido, reutilizarlo
  if (currentToken) {
    const tokenSnapshot = await db
      .collection(`users/${uid}/tenants/${tenantId}/reminderTokens`)
      .where('token', '==', currentToken)
      .limit(1)
      .get();

    if (!tokenSnapshot.empty) {
      const tokenData = tokenSnapshot.docs[0].data();
      const expiresAt = tokenData.expiresAt.toDate();
      const now = new Date();

      // Si el token aún es válido (no expiró), reutilizarlo
      if (expiresAt > now) {
        console.log(`[ensureReminderToken] Reusing existing token for reminder ${reminderId}`);
        return currentToken;
      }
    }
  }

  // Generar nuevo token
  const token = nanoid(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 días

  const tokenData = {
    token,
    reminderId,
    tenantId,
    expiresAt: Timestamp.fromDate(expiresAt),
    createdAt: Timestamp.fromDate(now),
  };

  // Guardar en Firestore usando el token como ID
  await db
    .doc(`users/${uid}/tenants/${tenantId}/reminderTokens/${token}`)
    .set(tokenData);

  // Actualizar el reminder con el nuevo token
  await db
    .doc(`users/${uid}/tenants/${tenantId}/reminders/${reminderId}`)
    .update({
      currentToken: token,
      updated_at: Timestamp.fromDate(now),
    });

  console.log(`[ensureReminderToken] Created new token for reminder ${reminderId}`);
  return token;
}

/**
 * Gets available payment types for tenant (those that don't need owner bill OR have locked owner bill)
 */
function getAvailablePaymentTypes(reminder: ReminderData): { name: string; amount?: number; currency: string }[] {
  if (!reminder.paymentTypeConfigs || reminder.paymentTypeConfigs.length === 0) {
    // Legacy mode: all types are available
    return reminder.payment_types.map(name => ({ name, currency: 'ARS' }));
  }

  return reminder.paymentTypeConfigs
    .filter(config => !config.requiresOwnerBill || config.ownerBill?.locked)
    .map(config => ({
      name: config.name,
      amount: config.requiresOwnerBill ? config.ownerBill?.amount : config.amount,
      currency: config.currency || 'ARS',
    }));
}

/**
 * Checks if there are any available payment types to remind about
 */
function hasAvailableTypes(reminder: ReminderData): boolean {
  const available = getAvailablePaymentTypes(reminder);
  const pendingAvailable = available.filter(t => !reminder.receiptsStatus[t.name]);
  return pendingAvailable.length > 0;
}

/**
 * Procesa un reminder y envía el mensaje de WhatsApp
 */
async function processReminder(reminder: ReminderData, session: string): Promise<boolean> {
  try {
    console.log(`[processReminder] Processing reminder ${reminder.id} for tenant ${reminder.tenantName}`);

    // Check if there are any available types to remind about
    if (!hasAvailableTypes(reminder)) {
      console.log(`[processReminder] No available types to remind for ${reminder.id}`);
      return true; // Skip but don't mark as failed
    }

    // 1. Asegurar que existe un token válido
    const token = await ensureReminderToken(
      reminder.uid,
      reminder.tenantId,
      reminder.id,
      reminder.currentToken
    );

    // 2. Generar link al portal
    const baseUrl = process.env.ADMIN_BASE_URL || 'http://localhost:3000';
    const portalLink = `${baseUrl}/inquilinos/${token}`;

    // 3. Get available payment types
    const availableTypes = getAvailablePaymentTypes(reminder);
    const pendingTypes = availableTypes.filter(t => !reminder.receiptsStatus[t.name]);
    const completedTypes = availableTypes.filter(t => reminder.receiptsStatus[t.name]);
    const isFirstReminder = reminder.sentCount === 0;

    // 4. Generar mensaje
    let message: string;
    if (reminder.paymentTypeConfigs && reminder.paymentTypeConfigs.length > 0) {
      message = generateReminderMessageWithConfigs(
        reminder.tenantName,
        portalLink,
        pendingTypes,
        completedTypes.map(t => t.name),
        isFirstReminder,
        reminder.reminderName
      );
    } else {
      message = generateReminderMessage(
        reminder.tenantName,
        portalLink,
        availableTypes.map(t => t.name),
        completedTypes.map(t => t.name),
        isFirstReminder
      );
    }

    // 5. Enviar WhatsApp
    const result = await sendPaymentReminder(session, reminder.tenantPhone, message);

    if (!result.success) {
      console.error(`[processReminder] Failed to send WhatsApp to ${reminder.tenantPhone}:`, result.error);
      return false;
    }

    // 6. Actualizar reminder en Firestore
    const now = new Date();
    const nextReminderDate = calculateNextReminderDate(
      reminder.reminder_interval_days,
      reminder.frequency,
      reminder.custom_frequency_days
    );

    await db
      .doc(`users/${reminder.uid}/tenants/${reminder.tenantId}/reminders/${reminder.id}`)
      .update({
        status: 'sent',
        lastSentAt: Timestamp.fromDate(now),
        nextReminderDate: Timestamp.fromDate(nextReminderDate),
        sentCount: FieldValue.increment(1),
        updated_at: Timestamp.fromDate(now),
      });

    console.log(`[processReminder] Successfully processed reminder ${reminder.id}. Next: ${nextReminderDate}`);
    return true;
  } catch (error) {
    console.error(`[processReminder] Error processing reminder ${reminder.id}:`, error);
    return false;
  }
}

/**
 * Busca y procesa todos los recordatorios pendientes
 */
export async function processPaymentReminders(): Promise<{
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
    console.log('[processPaymentReminders] Starting payment reminders cron job');

    const session = process.env.MULTIMAI_WS_SESSION || '';
    if (!session) {
      console.error('[processPaymentReminders] MULTIMAI_WS_SESSION not configured');
      return stats;
    }

    const now = new Date();
    const nowTimestamp = Timestamp.fromDate(now);

    // Buscar todos los reminders que necesitan ser enviados
    // Nota: Firestore no permite queries complejas con múltiples condiciones IN
    // Por lo que haremos la búsqueda en dos pasos

    // Buscar todos los reminders activos cuya nextReminderDate ya pasó
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;

      // Buscar todos los tenants del usuario
      const tenantsSnapshot = await db
        .collection(`users/${uid}/tenants`)
        .where('activo', '==', true)
        .get();

      for (const tenantDoc of tenantsSnapshot.docs) {
        const tenantId = tenantDoc.id;
        const tenantData = tenantDoc.data();

        // Buscar reminders activos de este tenant
        const remindersSnapshot = await db
          .collection(`users/${uid}/tenants/${tenantId}/reminders`)
          .where('active', '==', true)
          .get();

        for (const reminderDoc of remindersSnapshot.docs) {
          const reminderData = reminderDoc.data();

          // Filtrar solo los que están en status válido (pending, sent, partial)
          // Y que no estén completados
          if (reminderData.status === 'completed') {
            console.log(`[processPaymentReminders] Skipping completed reminder ${reminderDoc.id}`);
            continue;
          }

          // Si nextReminderDate existe, verificar si ya es tiempo de enviar
          // Si no existe, inicializarlo y enviarlo ahora
          if (reminderData.nextReminderDate) {
            const nextReminderDate = reminderData.nextReminderDate.toDate();
            if (nextReminderDate > now) {
              console.log(`[processPaymentReminders] Skipping reminder ${reminderDoc.id} - not yet time (next: ${nextReminderDate.toISOString()})`);
              continue;
            }
          } else {
            // Migración: inicializar nextReminderDate para reminders existentes
            console.log(`[processPaymentReminders] Initializing nextReminderDate for reminder ${reminderDoc.id}`);
            await db
              .doc(`users/${uid}/tenants/${tenantId}/reminders/${reminderDoc.id}`)
              .update({
                nextReminderDate: nowTimestamp,
                sentCount: reminderData.sentCount || 0,
              });
          }

          // Preparar datos del reminder
          const paymentTypeConfigs = (reminderData.paymentTypeConfigs || []).map((c: any) => ({
            ...c,
            ownerBill: c.ownerBill ? {
              ...c.ownerBill,
              uploadedAt: c.ownerBill.uploadedAt?.toDate?.() || (c.ownerBill.uploadedAt ? new Date(c.ownerBill.uploadedAt) : undefined),
            } : undefined,
          }));

          const reminder: ReminderData = {
            id: reminderDoc.id,
            uid,
            tenantId,
            tenantName: `${tenantData.nombre} ${tenantData.apellido}`,
            tenantPhone: tenantData.telefono,
            reminderName: reminderData.name,
            payment_types: reminderData.payment_types || [],
            custom_payment_types: reminderData.custom_payment_types,
            paymentTypeConfigs,
            receiptsStatus: reminderData.receiptsStatus || {},
            status: reminderData.status || 'pending',
            frequency: reminderData.frequency,
            custom_frequency_days: reminderData.custom_frequency_days,
            reminder_interval_days: reminderData.reminder_interval_days,
            nextReminderDate: reminderData.nextReminderDate?.toDate() || now,
            sentCount: reminderData.sentCount || 0,
            currentToken: reminderData.currentToken,
          };

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

    console.log('[processPaymentReminders] Cron job completed:', stats);
    return stats;
  } catch (error) {
    console.error('[processPaymentReminders] Fatal error:', error);
    return stats;
  }
}
