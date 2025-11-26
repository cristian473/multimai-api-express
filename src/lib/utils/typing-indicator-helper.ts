/**
 * Typing indicator utilities for WhatsApp
 * Centralizes typing indicator management to avoid duplication
 */

import { wsProxyClient } from '../other/wsProxyClient';

/**
 * Starts typing indicator in a WhatsApp chat
 * @param session - Session ID
 * @param chatId - Chat ID (format: phone@c.us)
 * @returns Promise that resolves when indicator starts
 */
export async function startTypingIndicator(
  session: string,
  chatId: string
): Promise<void> {
  try {
    await wsProxyClient.post(`/ws/start-typing`, {
      session,
      chatId,
    });
  } catch (error) {
    console.error('[TypingIndicator] ⚠️ Error starting typing indicator:', error);
    // Don't throw - typing indicator is not critical
  }
}

/**
 * Stops typing indicator in a WhatsApp chat
 * @param session - Session ID
 * @param chatId - Chat ID (format: phone@c.us)
 * @returns Promise that resolves when indicator stops
 */
export async function stopTypingIndicator(
  session: string,
  chatId: string
): Promise<void> {
  try {
    await wsProxyClient.post(`/ws/stop-typing`, {
      session,
      chatId,
    });
  } catch (error) {
    console.error('[TypingIndicator] ⚠️ Error stopping typing indicator:', error);
    // Don't throw - typing indicator is not critical
  }
}

/**
 * Executes a function with typing indicator
 * Automatically starts typing before and stops after execution
 * @param session - Session ID
 * @param chatId - Chat ID
 * @param fn - Async function to execute
 * @returns Result of the function
 */
export async function withTypingIndicator<T>(
  session: string,
  chatId: string,
  fn: () => Promise<T>
): Promise<T> {
  await startTypingIndicator(session, chatId);

  try {
    return await fn();
  } finally {
    await stopTypingIndicator(session, chatId);
  }
}
