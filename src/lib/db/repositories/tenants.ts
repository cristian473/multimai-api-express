import { db } from "@/lib/db/firebase";
import type { Tenant, PaymentReminder, PaymentReceipt } from "@/lib/types/tenant";

/**
 * Obtiene un tenant por su número de teléfono
 */
export async function getTenantByPhone(
  uid: string,
  phone: string
): Promise<{ id: string; data: Tenant } | null> {
  try {
    const tenantsSnapshot = await db
      .collection(`users/${uid}/tenants`)
      .where('telefono', 'array-contains', phone)
      .where('activo', '==', true)
      .limit(1)
      .get();

    if (tenantsSnapshot.empty) {
      return null;
    }

    const tenantDoc = tenantsSnapshot.docs[0];
    return {
      id: tenantDoc.id,
      data: tenantDoc.data() as Tenant
    };
  } catch (error) {
    console.error('[getTenantByPhone] Error:', error);
    return null;
  }
}

/**
 * Obtiene todos los recordatorios de pago activos de un tenant
 */
export async function getPaymentReminders(
  uid: string,
  tenantId: string
): Promise<Array<{ id: string; data: PaymentReminder }>> {
  try {
    const remindersSnapshot = await db
      .collection(`users/${uid}/tenants/${tenantId}/reminders`)
      .where('active', '==', true)
      .get();

    return remindersSnapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as PaymentReminder
    }));
  } catch (error) {
    console.error('[getPaymentReminders] Error:', error);
    return [];
  }
}

/**
 * Busca el reminder que mejor coincida con la fecha y tipo de pago
 */
export async function findMatchingReminder(
  uid: string,
  tenantId: string,
  paymentDate: Date,
  paymentType: string
): Promise<{ id: string; data: PaymentReminder } | null> {
  try {
    const reminders = await getPaymentReminders(uid, tenantId);

    if (reminders.length === 0) {
      console.log('[findMatchingReminder] No active reminders found');
      return null;
    }

    // Normalizar el tipo de pago para comparación
    const normalizedPaymentType = paymentType.toLowerCase().trim();

    // Buscar reminders que coincidan con el tipo de pago
    const matchingReminders = reminders.filter(reminder => {
      const types = [
        ...(reminder.data.payment_types || []),
        ...(reminder.data.custom_payment_types || [])
      ].map(t => t.toLowerCase().trim());

      return types.some(type =>
        type.includes(normalizedPaymentType) ||
        normalizedPaymentType.includes(type)
      );
    });

    if (matchingReminders.length === 0) {
      console.log('[findMatchingReminder] No matching reminders found for type:', paymentType);
      // Si no hay coincidencia exacta, retornar el primer reminder activo
      return reminders[0] || null;
    }

    // Si hay múltiples coincidencias, retornar la primera
    console.log('[findMatchingReminder] Found matching reminder:', matchingReminders[0].id);
    return matchingReminders[0];
  } catch (error) {
    console.error('[findMatchingReminder] Error:', error);
    return null;
  }
}

/**
 * Guarda un comprobante de pago en Firestore
 */
export async function savePaymentReceipt(
  uid: string,
  tenantId: string,
  reminderId: string,
  receipt: Omit<PaymentReceipt, 'id' | 'created_at'>
): Promise<string> {
  try {
    const receiptData = {
      ...receipt,
      created_at: new Date()
    };

    const receiptRef = await db
      .collection(`users/${uid}/tenants/${tenantId}/reminders/${reminderId}/paymentReceipt`)
      .add(receiptData);

    console.log('[savePaymentReceipt] Receipt saved with ID:', receiptRef.id);
    return receiptRef.id;
  } catch (error) {
    console.error('[savePaymentReceipt] Error:', error);
    throw error;
  }
}

/**
 * Obtiene todos los comprobantes de pago de un reminder
 */
export async function getPaymentReceipts(
  uid: string,
  tenantId: string,
  reminderId: string
): Promise<Array<{ id: string; data: PaymentReceipt }>> {
  try {
    const receiptsSnapshot = await db
      .collection(`users/${uid}/tenants/${tenantId}/reminders/${reminderId}/paymentReceipt`)
      .orderBy('receivedAt', 'desc')
      .get();

    return receiptsSnapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as PaymentReceipt
    }));
  } catch (error) {
    console.error('[getPaymentReceipts] Error:', error);
    return [];
  }
}

/**
 * Actualiza un comprobante de pago como verificado
 */
export async function verifyPaymentReceipt(
  uid: string,
  tenantId: string,
  reminderId: string,
  receiptId: string
): Promise<boolean> {
  try {
    await db
      .collection(`users/${uid}/tenants/${tenantId}/reminders/${reminderId}/paymentReceipt`)
      .doc(receiptId)
      .update({
        verified: true,
        verified_at: new Date()
      });

    console.log('[verifyPaymentReceipt] Receipt verified:', receiptId);
    return true;
  } catch (error) {
    console.error('[verifyPaymentReceipt] Error:', error);
    return false;
  }
}
