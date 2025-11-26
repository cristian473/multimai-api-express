import { wsProxyClient } from '../other/wsProxyClient';
import { formatChatId } from '../utils/message-helpers';
import { processSingleTextMessage } from '../utils/response-processor';

interface PaymentTypeWithAmount {
  name: string;
  amount?: number;
  currency: string;
}

/**
 * Sends a payment reminder via WhatsApp
 */
export async function sendPaymentReminder(
  session: string,
  phone: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const chatId = formatChatId(phone);
    const messages = processSingleTextMessage(message);

    await wsProxyClient.post('/ws/send-message', { chatId, session, messages });

    console.log(`[sendPaymentReminder] Message sent to ${phone}`);
    return { success: true };
  } catch (error) {
    console.error('[sendPaymentReminder] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error al enviar mensaje' };
  }
}

/**
 * Sends an owner reminder via WhatsApp
 */
export async function sendOwnerReminder(
  session: string,
  phone: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const chatId = formatChatId(phone);
    const messages = processSingleTextMessage(message);

    await wsProxyClient.post('/ws/send-message', { chatId, session, messages });

    console.log(`[sendOwnerReminder] Message sent to ${phone}`);
    return { success: true };
  } catch (error) {
    console.error('[sendOwnerReminder] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error al enviar mensaje' };
  }
}

/**
 * Sends notification to tenant that bills are available
 */
export async function sendTenantBillsAvailable(
  session: string,
  phone: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const chatId = formatChatId(phone);
    const messages = processSingleTextMessage(message);

    await wsProxyClient.post('/ws/send-message', { chatId, session, messages });

    console.log(`[sendTenantBillsAvailable] Message sent to ${phone}`);
    return { success: true };
  } catch (error) {
    console.error('[sendTenantBillsAvailable] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error al enviar mensaje' };
  }
}

/**
 * Formats currency amount
 */
function formatAmount(amount: number, currency: string): string {
  const symbol = currency === 'USD' ? 'US$' : '$';
  return `${symbol} ${amount.toLocaleString('es-AR')}`;
}

/**
 * Generates reminder message (legacy - without configs)
 */
export function generateReminderMessage(
  tenantName: string,
  portalLink: string,
  allPaymentTypes: string[],
  completedTypes: string[],
  isFirstReminder: boolean
): string {
  const pendingTypes = allPaymentTypes.filter(type => !completedTypes.includes(type));

  if (isFirstReminder) {
    return `Hola *${tenantName}*,

Es momento de cargar los comprobantes de pago del mes. Por favor, ingresá al siguiente enlace para subir los comprobantes:

${portalLink}

📋 *Tipos de pago requeridos:*
${allPaymentTypes.map(type => `• ${type}`).join('\n')}

Una vez que hayas subido todos los comprobantes, la administración será notificada automáticamente.

_Mensaje generado automáticamente_`;
  } else {
    const completedCount = completedTypes.length;
    const totalCount = allPaymentTypes.length;

    return `Hola *${tenantName}*,

Recordatorio: aún faltan *${pendingTypes.length}* comprobante${pendingTypes.length !== 1 ? 's' : ''} por subir.

✅ *Ya recibidos (${completedCount}/${totalCount}):*
${completedTypes.map(type => `• ${type}`).join('\n')}

⏳ *Faltan:*
${pendingTypes.map(type => `• ${type}`).join('\n')}

Ingresá aquí para completar la carga:
${portalLink}

_Mensaje generado automáticamente_`;
  }
}

/**
 * Generates reminder message with payment type configs (amounts)
 */
export function generateReminderMessageWithConfigs(
  tenantName: string,
  portalLink: string,
  pendingTypes: PaymentTypeWithAmount[],
  completedTypeNames: string[],
  isFirstReminder: boolean,
  reminderName?: string
): string {
  const titleLine = reminderName ? `\n📌 *${reminderName}*\n` : '';

  if (isFirstReminder) {
    const typesWithAmounts = pendingTypes.map(t => {
      if (t.amount) return `• ${t.name}: ${formatAmount(t.amount, t.currency)}`;
      return `• ${t.name}`;
    }).join('\n');

    return `Hola *${tenantName}*,${titleLine}
Es momento de cargar los comprobantes de pago. Por favor, ingresá al siguiente enlace para subir los comprobantes:

${portalLink}

💰 *Pagos pendientes:*
${typesWithAmounts}

Una vez que hayas subido todos los comprobantes, la administración será notificada automáticamente.

_Mensaje generado automáticamente_`;
  } else {
    const typesWithAmounts = pendingTypes.map(t => {
      if (t.amount) return `• ${t.name}: ${formatAmount(t.amount, t.currency)}`;
      return `• ${t.name}`;
    }).join('\n');

    return `Hola *${tenantName}*,${titleLine}
Recordatorio: aún faltan *${pendingTypes.length}* comprobante${pendingTypes.length !== 1 ? 's' : ''} por subir.

${completedTypeNames.length > 0 ? `✅ *Ya recibidos:*\n${completedTypeNames.map(t => `• ${t}`).join('\n')}\n\n` : ''}⏳ *Pagos pendientes:*
${typesWithAmounts}

Ingresá aquí para completar la carga:
${portalLink}

_Mensaje generado automáticamente_`;
  }
}

/**
 * Generates owner reminder message for bill uploads
 */
export function generateOwnerReminderMessage(
  ownerName: string,
  tenantName: string,
  paymentTypes: string[],
  portalLink: string,
  reminderName?: string
): string {
  const titleLine = reminderName ? `\n📌 *${reminderName}*\n` : '';

  return `Hola *${ownerName}*,${titleLine}
Es momento de cargar las boletas de pago para el inquilino *${tenantName}*.

📋 *Boletas pendientes:*
${paymentTypes.map(type => `• ${type}`).join('\n')}

Por favor, ingresá al siguiente enlace para cargar las boletas con los montos:

${portalLink}

⚠️ *Importante:* Tendrás 24 horas para realizar modificaciones una vez cargadas las boletas. Luego, se notificará al inquilino para que realice los pagos.

_Mensaje generado automáticamente_`;
}

/**
 * Generates message notifying tenant that bills are now available
 */
export function generateBillsAvailableMessage(
  tenantName: string,
  availableTypes: PaymentTypeWithAmount[],
  portalLink: string,
  reminderName?: string
): string {
  const titleLine = reminderName ? `\n📌 *${reminderName}*\n` : '';

  const typesWithAmounts = availableTypes.map(t => {
    if (t.amount) return `• ${t.name}: ${formatAmount(t.amount, t.currency)}`;
    return `• ${t.name}`;
  }).join('\n');

  return `Hola *${tenantName}*,${titleLine}
¡Las boletas de pago ya están disponibles! 🎉

💰 *Pagos disponibles:*
${typesWithAmounts}

Ya podés acceder al siguiente enlace para ver las boletas y cargar tus comprobantes de pago:

${portalLink}

_Mensaje generado automáticamente_`;
}

/**
 * Generates completion notification for owner
 */
export function generateOwnerCompletionMessage(
  ownerName: string,
  tenantName: string,
  completedTypes: string[],
  reminderName?: string,
  receiptsLink?: string
): string {
  const titleLine = reminderName ? `\n📌 *${reminderName}*\n` : '';

  let message = `Hola *${ownerName}*,${titleLine}
El inquilino *${tenantName}* ha completado la carga de todos los comprobantes de pago. ✅

📋 *Comprobantes recibidos:*
${completedTypes.map(type => `• ${type}`).join('\n')}`;

  if (receiptsLink) {
    message += `

📎 Puede ver y descargar los comprobantes aquí:
${receiptsLink}`;
  }

  message += `

_Mensaje generado automáticamente_`;

  return message;
}

/**
 * Generates completion notification for admin/agency
 */
export function generateAdminCompletionMessage(
  tenantName: string,
  ownerName: string,
  completedTypes: string[],
  historyLink: string,
  reminderName?: string
): string {
  const titleLine = reminderName ? `\n📌 *${reminderName}*\n` : '';

  return `¡Pagos completos! ✅${titleLine}
Inquilino: *${tenantName}*
Dueño: *${ownerName}*

📋 *Comprobantes recibidos:*
${completedTypes.map(type => `• ${type}`).join('\n')}

Ver historial completo:
${historyLink}

_Mensaje generado automáticamente_`;
}
