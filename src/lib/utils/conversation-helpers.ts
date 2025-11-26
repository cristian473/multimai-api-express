/**
 * Conversation context building utilities
 * Centralizes conversation context construction
 */

import type { ConversationContext } from '../ai/types/context';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Builds a conversation context from message history
 * @param history - Array of chat messages
 * @param userId - User ID
 * @param sessionId - Session ID
 * @returns ConversationContext object
 */
export function buildConversationContext(
  history: ChatMessage[],
  userId: string,
  sessionId: string
): ConversationContext {
  return {
    messages: history.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content
    })),
    userId,
    sessionId,
  };
}

/**
 * Summarizes the last N messages from conversation
 * @param messages - Array of messages
 * @param count - Number of recent messages to include
 * @returns Formatted conversation summary
 */
export function summarizeRecentMessages(
  messages: ChatMessage[],
  count: number = 10
): string {
  const recent = messages.slice(-count);
  return recent
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');
}
