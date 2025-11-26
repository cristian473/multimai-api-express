/**
 * Message formatting utilities
 * Centralizes message formatting logic to avoid duplication
 */

export interface MessageReference {
  messageReferencesTo?: string | null;
  messageReferencesToProduct?: {
    title: string;
    description: string;
  } | null;
}

/**
 * Formats a user message with optional references to previous messages or products
 * @param message - The main message content
 * @param messageReferencesTo - Optional reference to a previous message
 * @param messageReferencesToProduct - Optional reference to a product
 * @param userName - The name of the user sending the message
 * @returns Formatted message string
 */
export function formatUserMessage(
  message: string,
  messageReferencesTo: string | null,
  messageReferencesToProduct: { title: string; description: string } | null,
  userName: string
): string {
  if (messageReferencesTo) {
    return `(hace referencia al mensaje: "${messageReferencesTo}") ${message}`;
  }

  if (messageReferencesToProduct) {
    return `(hace referencia al producto: "Titulo: ${messageReferencesToProduct.title}, Descripción: ${messageReferencesToProduct.description}") ${userName}: ${message}`;
  }

  return message;
}

/**
 * Combines multiple messages into a single string
 * @param messages - Array of message bodies
 * @returns Combined message string
 */
export function combineMessages(messages: string[]): string {
  return messages.join(" ");
}

/**
 * Formats a chat ID to WhatsApp format
 * @param phone - Phone number with or without @c.us suffix
 * @returns Formatted chat ID with @c.us suffix
 */
export function formatChatId(phone: string): string {
  if (phone.endsWith('@c.us')) {
    return phone;
  }
  return `${phone}@c.us`;
}

/**
 * Extracts phone number from chat ID
 * @param chatId - Chat ID in format phone@c.us
 * @returns Phone number without @c.us suffix
 */
export function extractPhoneFromChatId(chatId: string): string {
  return chatId.split('@')[0];
}
