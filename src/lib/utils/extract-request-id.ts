import { WhatsAppWebhookPayload } from "../../entities/ws/ws.dto";

/**
 * Extrae el requestId de un mensaje de WhatsApp
 * Busca en el cuerpo del mensaje o en el mensaje al que se hace referencia
 *
 * Formato esperado: "_Request ID: abc123_" o "Request ID: abc123"
 */
export function extractRequestId(
  payload: WhatsAppWebhookPayload,
): string | null {
  // Buscar en el mensaje al que se responde (replyTo)
  if (payload.payload.replyTo?.body) {
    const match = payload.payload.replyTo.body.match(
      /Request ID:\s*([a-zA-Z0-9-_]+)/i,
    );
    if (match) {
      return match[1];
    }
  }

  // Buscar en el cuerpo del mensaje actual
  if (payload.payload.body) {
    const match = payload.payload.body.match(/Request ID:\s*([a-zA-Z0-9-_]+)/i);
    if (match) {
      return match[1];
    }
  }

  return null;
}
