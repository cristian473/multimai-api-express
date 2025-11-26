import { tool } from "ai";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import {
  getTenantByPhone,
  getPaymentReminders,
  findMatchingReminder,
  savePaymentReceipt,
} from "@/lib/db/repositories/tenants";
import {
  extractPaymentReceiptData,
  generatePaymentSummary,
  validatePaymentDate,
} from "@/lib/ai/utils/payment-receipt-extractor";
import { getHelpTool } from "./index";

/**
 * Tool: receive_payment_receipt
 * Procesa un comprobante de pago enviado por un inquilino
 */
export const receivePaymentReceiptTool = (
  uid: string,
  userPhone: string,
  userName: string
) =>
  tool({
    description:
      "Procesa un comprobante de pago enviado por el inquilino. Extrae automáticamente la información del comprobante (fecha, tipo de pago, monto) usando AI vision, encuentra el recordatorio de pago correspondiente y guarda el comprobante en la base de datos.",
    inputSchema: z.object({
      imageUrl: z
        .string()
        .describe("URL de la imagen o PDF del comprobante de pago"),
      mimetype: z
        .string()
        .describe("Tipo MIME del archivo (ej: image/jpeg, application/pdf)"),
    }),
    execute: async ({ imageUrl, mimetype }) => {
      try {
        console.log("[receivePaymentReceiptTool] Processing payment receipt");
        console.log("[receivePaymentReceiptTool] User:", userName, userPhone);
        console.log("[receivePaymentReceiptTool] Image URL:", imageUrl);

        // 1. Verificar que el usuario es un tenant
        const tenant = await getTenantByPhone(uid, userPhone);

        if (!tenant) {
          console.log(
            "[receivePaymentReceiptTool] User is not a tenant:",
            userPhone
          );
          return JSON.stringify({
            success: false,
            message:
              "No encontré tu registro como inquilino. Por favor contacta con la administración.",
          });
        }

        console.log("[receivePaymentReceiptTool] Tenant found:", tenant.id);

        // 2. Extraer datos del comprobante usando Gemini Vision
        console.log(
          "[receivePaymentReceiptTool] Extracting data from receipt..."
        );
        const extractedData = await extractPaymentReceiptData(
          imageUrl,
          mimetype
        );

        console.log(
          "[receivePaymentReceiptTool] Extracted data:",
          extractedData
        );

        // 3. Validar la fecha extraída
        if (!validatePaymentDate(extractedData.paymentDate)) {
          console.warn(
            "[receivePaymentReceiptTool] Invalid payment date:",
            extractedData.paymentDate
          );
          extractedData.confidence = Math.min(extractedData.confidence, 0.5);
        }

        // 4. Encontrar el reminder correspondiente
        const paymentDate = new Date(extractedData.paymentDate);
        const matchingReminder = await findMatchingReminder(
          uid,
          tenant.id,
          paymentDate,
          extractedData.paymentType
        );

        if (!matchingReminder) {
          console.log(
            "[receivePaymentReceiptTool] No matching reminder found"
          );
          // Aún así guardar el comprobante, pero sin reminder específico
          // Crear un mensaje para el usuario indicando que no se encontró el recordatorio
          return JSON.stringify({
            success: false,
            message:
              "Recibí tu comprobante, pero no encontré un recordatorio de pago que coincida. Por favor contacta con la administración para verificar.",
            extractedData: {
              fecha: extractedData.paymentDate,
              tipo: extractedData.paymentType,
              monto: extractedData.amount,
            },
          });
        }

        console.log(
          "[receivePaymentReceiptTool] Matching reminder found:",
          matchingReminder.id
        );

        // 5. Generar resumen del pago
        const summary = generatePaymentSummary(extractedData);

        // 6. Guardar el comprobante en Firestore
        const receiptId = await savePaymentReceipt(
          uid,
          tenant.id,
          matchingReminder.id,
          {
            tenant_id: tenant.id,
            reminder_id: matchingReminder.id,
            urlFile: imageUrl,
            tag: extractedData.paymentType,
            summary: summary,
            payment_date: paymentDate,
            payment_time: extractedData.paymentTime,
            payment_type: extractedData.paymentType,
            amount: extractedData.amount,
            receivedAt: Timestamp.now(),
            extracted_data: {
              raw_text: extractedData.raw_text,
              confidence: extractedData.confidence,
              description: extractedData.description,
            },
            verified: false,
          }
        );

        console.log(
          "[receivePaymentReceiptTool] Receipt saved with ID:",
          receiptId
        );

        // 7. Preparar mensaje de respuesta
        let responseMessage = `¡Perfecto! Recibí tu comprobante de pago.\n\n`;
        responseMessage += `📄 *Resumen:*\n`;
        responseMessage += `${summary}\n\n`;

        if (extractedData.confidence < 0.7) {
          responseMessage += `⚠️ Nota: Algunos datos del comprobante no fueron muy claros. La administración verificará la información manualmente.\n\n`;
        }

        responseMessage += `✓ El comprobante fue registrado exitosamente y la administración será notificada.`;

        return JSON.stringify({
          success: true,
          message: responseMessage,
          receiptId: receiptId,
          extractedData: {
            fecha: extractedData.paymentDate,
            hora: extractedData.paymentTime,
            tipo: extractedData.paymentType,
            monto: extractedData.amount,
            confianza: extractedData.confidence,
          },
        });
      } catch (error) {
        console.error("[receivePaymentReceiptTool] Error:", error);
        return JSON.stringify({
          success: false,
          message:
            "Hubo un error al procesar el comprobante. Por favor intenta de nuevo o contacta con la administración.",
          error: String(error),
        });
      }
    },
  });

/**
 * Tool: get_payment_reminders
 * Obtiene los recordatorios de pago activos del inquilino
 */
export const getPaymentRemindersTool = (uid: string, userPhone: string) =>
  tool({
    description:
      "Obtiene información sobre los recordatorios de pago activos del inquilino, incluyendo próximos vencimientos y tipos de pago configurados",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        console.log("[getPaymentRemindersTool] Getting payment reminders");
        console.log("[getPaymentRemindersTool] User phone:", userPhone);

        // 1. Verificar que el usuario es un tenant
        const tenant = await getTenantByPhone(uid, userPhone);

        if (!tenant) {
          return JSON.stringify({
            success: false,
            message:
              "No encontré tu registro como inquilino. Por favor contacta con la administración.",
          });
        }

        // 2. Obtener los recordatorios activos
        const reminders = await getPaymentReminders(uid, tenant.id);

        if (reminders.length === 0) {
          return JSON.stringify({
            success: true,
            message:
              "No tienes recordatorios de pago configurados. Contacta con la administración si necesitas configurar recordatorios.",
            reminders: [],
          });
        }

        // 3. Formatear la información de los recordatorios
        const remindersInfo = reminders.map((reminder) => {
          const paymentTypes = [
            ...(reminder.data.payment_types || []),
            ...(reminder.data.custom_payment_types || []),
          ];

          let frequency = "";
          switch (reminder.data.frequency) {
            case "weekly":
              frequency = "semanal";
              break;
            case "monthly":
              frequency = "mensual";
              break;
            case "bimonthly":
              frequency = "bimestral";
              break;
            case "custom":
              frequency = `cada ${reminder.data.custom_frequency_days} días`;
              break;
          }

          return {
            tipos_de_pago: paymentTypes.join(", "),
            frecuencia: frequency,
            activo: reminder.data.active,
          };
        });

        let message = `📋 *Tus recordatorios de pago:*\n\n`;
        remindersInfo.forEach((info, index) => {
          message += `${index + 1}. *${info.tipos_de_pago}*\n`;
          message += `   Frecuencia: ${info.frecuencia}\n\n`;
        });

        return JSON.stringify({
          success: true,
          message: message,
          reminders: remindersInfo,
        });
      } catch (error) {
        console.error("[getPaymentRemindersTool] Error:", error);
        return JSON.stringify({
          success: false,
          message:
            "Hubo un error al obtener tus recordatorios. Por favor intenta de nuevo.",
          error: String(error),
        });
      }
    },
  });

/**
 * Tool: get_help (especializado para tenants)
 * Reutiliza la tool get_help existente pero adaptada para inquilinos
 */
export function getTenantHelpTool(
  uid: string,
  userPhone: string,
  userName: string
) {
  return getHelpTool(uid, userPhone, userName);
}
