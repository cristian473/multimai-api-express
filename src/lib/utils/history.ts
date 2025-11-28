/**
 * History Utilities
 * 
 * This module provides backward-compatible functions for loading conversation history.
 * All functions now delegate to the centralized conversation-loader module.
 */

import {
  loadConversationForLLM,
  getMessagesForLLM,
  type LLMMessage,
} from '../ai/context/conversation-loader';
import { getMultimaiMessages } from '../db/repositories/conversations';
import logger from 'jet-logger';

// Re-export types for backward compatibility
export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  chatMessageId?: string;
};

/**
 * Get conversation history for agent context
 * Uses centralized loadConversationForLLM under the hood
 * 
 * @deprecated Use loadConversationForLLM from '../../ai/context' for more control
 */
export async function getHistory(uid: string, userPhone: string): Promise<ChatMessage[]> {
  try {
    const result = await loadConversationForLLM(uid, userPhone, {
      includeContextMessages: true,
      includePreviousSummaries: true,
      maxPreviousSummaries: 5,
    });

    return result.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      chatMessageId: msg.chatMessageId,
    }));
  } catch (error) {
    logger.err(`[History] Error loading history: ${error}`);
    return [];
  }
}

/**
 * Get history for Multimai agent (global agent, not per-user)
 */
export async function getMultimaiHistory(userPhone: string): Promise<ChatMessage[]> {
  const conversationHistory: ChatMessage[] = [];

  try {
    const messages = await getMultimaiMessages(userPhone, 50);

    if (messages.length > 0) {
      logger.info(`[History] Loaded ${messages.length} messages from multimai agent`);
      conversationHistory.push(
        ...messages.map((msg) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          chatMessageId: msg.chatMessageId,
        }))
      );
    } else {
      logger.info('[History] No messages found in multimai agent collection');
    }
  } catch (error) {
    logger.err(`[History] Error loading multimai history: ${error}`);
  }

  return conversationHistory;
}

/**
 * Get only previous conversation summaries (for context injection)
 * 
 * @deprecated Use loadConversationForLLM with includePreviousSummaries option
 */
export async function getPreviousSummariesContext(uid: string, userPhone: string): Promise<string | null> {
  try {
    const result = await loadConversationForLLM(uid, userPhone, {
      includeContextMessages: false,
      includePreviousSummaries: true,
      maxPreviousSummaries: 5,
      maxMessages: 1, // Only get the summaries system message
      filterRoles: ['system'],
    });

    const summaryMessage = result.messages.find(
      (m) => m.role === 'system' && m.content.includes('Contexto de conversaciones anteriores')
    );

    if (summaryMessage) {
      // Extract just the summaries part without the header
      const content = summaryMessage.content;
      const headerEnd = content.indexOf('\n');
      return headerEnd > 0 ? content.substring(headerEnd + 1) : content;
    }

    return null;
  } catch (error) {
    logger.err(`[History] Error loading previous summaries: ${error}`);
    return null;
  }
}

// Re-export from conversation-loader for convenience
export { loadConversationForLLM, getMessagesForLLM, type LLMMessage };
