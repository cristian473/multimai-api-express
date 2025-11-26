/**
 * WhatsApp Status Helpers
 * Utilities for managing WhatsApp message status indicators
 */

import { wsProxyClient } from '../other/wsProxyClient';
import { WhatsAppWebhookPayload } from '../../entities/ws/ws.dto';

/**
 * Mark a message as seen/read
 */
export async function sendSeen(webhookPayload: WhatsAppWebhookPayload): Promise<boolean> {
  try {
    const { session, payload: { from: chatId } } = webhookPayload;
    await wsProxyClient.post(`/ws/send-seen`, {
      session,
      chatId,
    });
    console.log("[WhatsApp] ✅ Message marked as seen");
    return true;
  } catch (error) {
    console.error("[WhatsApp] ⚠️ Error marking message as seen:", error);
    return false;
  }
}

/**
 * Start typing indicator
 */
export async function startTyping(webhookPayload: WhatsAppWebhookPayload): Promise<boolean> {
  try {
    const { session, payload: { from: chatId } } = webhookPayload;
    await wsProxyClient.post(`/ws/start-typing`, {
      session,
      chatId,
    });
    console.log("[WhatsApp] ⌨️ Typing indicator started");
    return true;
  } catch (error) {
    console.error("[WhatsApp] ⚠️ Error starting typing indicator:", error);
    return false;
  }
}

/**
 * Stop typing indicator
 */
export async function stopTyping(webhookPayload: WhatsAppWebhookPayload): Promise<boolean> {
  try {
    const { session, payload: { from: chatId } } = webhookPayload;
    await wsProxyClient.post(`/ws/stop-typing`, {
      session,
      chatId,
    });
    console.log("[WhatsApp] ⌨️ Typing indicator stopped");
    return true;
  } catch (error) {
    console.error("[WhatsApp] ⚠️ Error stopping typing indicator:", error);
    return false;
  }
}