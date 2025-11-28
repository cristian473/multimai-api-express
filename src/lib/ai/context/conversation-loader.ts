/**
 * Centralized Conversation Loader
 * 
 * This module provides a single source of truth for loading conversation history
 * for LLM text generation. All places that need to load messages should use this.
 */

import {
  getActiveConversationMessages,
  getPreviousConversationSummaries,
} from '../../db/repositories/conversations';
import logger from 'jet-logger';

/**
 * Message type for LLM context
 */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  chatMessageId?: string;
  isContext?: boolean;
  timestamp?: Date;
}

/**
 * Options for loading conversation history
 */
export interface LoadConversationOptions {
  /** Include system/context messages (tool executions, etc.). Default: true */
  includeContextMessages?: boolean;
  /** Include summaries from previous closed conversations. Default: true */
  includePreviousSummaries?: boolean;
  /** Maximum number of previous summaries to include. Default: 5 */
  maxPreviousSummaries?: number;
  /** Maximum number of messages to return (0 = unlimited). Default: 0 */
  maxMessages?: number;
  /** Filter by specific roles. Default: all roles */
  filterRoles?: Array<'user' | 'assistant' | 'system'>;
  /** Only return messages without context flag. Default: false */
  excludeContextFlagged?: boolean;
}

/**
 * Result from loading conversation
 */
export interface LoadConversationResult {
  messages: LLMMessage[];
  hasActiveConversation: boolean;
  previousSummariesCount: number;
  totalMessageCount: number;
}

/**
 * Default options for loading conversation
 */
const DEFAULT_OPTIONS: Required<LoadConversationOptions> = {
  includeContextMessages: true,
  includePreviousSummaries: true,
  maxPreviousSummaries: 5,
  maxMessages: 0,
  filterRoles: ['user', 'assistant', 'system'],
  excludeContextFlagged: false,
};

/**
 * Load conversation history for LLM text generation
 * 
 * This is the centralized function that should be used everywhere to load
 * conversation messages for LLM context. It includes:
 * - Messages from the active conversation (user, assistant, system)
 * - Context messages from tool executions (system role with isContext: true)
 * - Summaries from previous closed conversations
 * 
 * @param uid - User/agent ID
 * @param userPhone - Customer phone number
 * @param options - Optional configuration for loading
 * @returns LoadConversationResult with messages and metadata
 * 
 * @example
 * // Load all messages including context
 * const result = await loadConversationForLLM(uid, userPhone);
 * 
 * @example
 * // Load only user and assistant messages (no context)
 * const result = await loadConversationForLLM(uid, userPhone, {
 *   includeContextMessages: false,
 *   filterRoles: ['user', 'assistant']
 * });
 * 
 * @example
 * // Load limited messages for quick response
 * const result = await loadConversationForLLM(uid, userPhone, {
 *   maxMessages: 20,
 *   includePreviousSummaries: false
 * });
 */
export async function loadConversationForLLM(
  uid: string,
  userPhone: string,
  options: LoadConversationOptions = {}
): Promise<LoadConversationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const messages: LLMMessage[] = [];
  let previousSummariesCount = 0;
  let hasActiveConversation = false;

  try {
    // 1. Load summaries from previous closed conversations (as system context)
    if (opts.includePreviousSummaries) {
      const previousSummaries = await getPreviousConversationSummaries(
        uid,
        userPhone,
        opts.maxPreviousSummaries
      );

      if (previousSummaries.length > 0) {
        previousSummariesCount = previousSummaries.length;

        const summariesText = previousSummaries
          .filter((s) => s.summary && s.summary.trim() !== '')
          .map((s) => {
            const dateStr = s.date || (s.closedAt ? formatTimestamp(s.closedAt) : 'conversación anterior');
            return `[${dateStr}] ${s.summary}`;
          })
          .join('\n\n');

        if (summariesText && opts.filterRoles.includes('system')) {
          messages.push({
            role: 'system',
            content: `Contexto de conversaciones anteriores con este cliente:\n${summariesText}`,
            isContext: true,
          });
        }
      }
    }

    // 2. Load messages from active conversation (includes user, assistant, and system/context)
    const activeMessages = await getActiveConversationMessages(
      uid,
      userPhone,
      opts.includeContextMessages // Pass true to include context messages from DB
    );

    if (activeMessages.length > 0) {
      hasActiveConversation = true;
      logger.info(`[ConversationLoader] Loaded ${activeMessages.length} messages from active conversation`);

      for (const msg of activeMessages) {
        const role = msg.role as 'user' | 'assistant' | 'system';

        // Filter by roles
        if (!opts.filterRoles.includes(role)) {
          continue;
        }

        // Filter out context-flagged messages if requested
        if (opts.excludeContextFlagged && msg.isContext) {
          continue;
        }

        messages.push({
          role,
          content: msg.content,
          chatMessageId: msg.whatsappMessageId || msg.chatMessageId,
          isContext: msg.isContext || false,
          timestamp: msg.timestamp?.toDate?.() || msg.timestamp,
        });
      }
    } else {
      logger.info('[ConversationLoader] No messages in active conversation');
    }
  } catch (error) {
    logger.err(`[ConversationLoader] Error loading conversation: ${error}`);
  }

  // Apply max messages limit if specified (preserve system context messages at start)
  let finalMessages = messages;
  if (opts.maxMessages > 0 && messages.length > opts.maxMessages) {
    // Keep system context messages at the beginning
    const systemContext = messages.filter(m => m.role === 'system' && m.isContext);
    const otherMessages = messages.filter(m => !(m.role === 'system' && m.isContext));
    
    // Take the most recent non-context messages
    const limitedOther = otherMessages.slice(-Math.max(0, opts.maxMessages - systemContext.length));
    finalMessages = [...systemContext, ...limitedOther];
  }

  console.log('finalMessages', JSON.stringify(finalMessages, null, 2));

  return {
    messages: finalMessages,
    hasActiveConversation,
    previousSummariesCount,
    totalMessageCount: finalMessages.length,
  };
}

/**
 * Simplified function to get messages as array for LLM APIs
 * 
 * @param uid - User/agent ID
 * @param userPhone - Customer phone number
 * @param options - Optional configuration
 * @returns Array of messages in LLM format { role, content }
 */
export async function getMessagesForLLM(
  uid: string,
  userPhone: string,
  options: LoadConversationOptions = {}
): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>> {
  const result = await loadConversationForLLM(uid, userPhone, options);
  return result.messages.map(({ role, content }) => ({ role, content }));
}

/**
 * Get only conversation messages (no context/tool executions)
 * Useful for displaying in UI or for analysis
 */
export async function getConversationMessagesOnly(
  uid: string,
  userPhone: string,
  options: Omit<LoadConversationOptions, 'includeContextMessages' | 'excludeContextFlagged'> = {}
): Promise<LLMMessage[]> {
  const result = await loadConversationForLLM(uid, userPhone, {
    ...options,
    includeContextMessages: false,
    excludeContextFlagged: true,
    filterRoles: ['user', 'assistant'],
  });
  return result.messages;
}

/**
 * Get full context including all system messages
 * Useful for AI analysis and lead qualification
 */
export async function getFullConversationContext(
  uid: string,
  userPhone: string,
  maxPreviousSummaries: number = 5
): Promise<LLMMessage[]> {
  const result = await loadConversationForLLM(uid, userPhone, {
    includeContextMessages: true,
    includePreviousSummaries: true,
    maxPreviousSummaries,
    filterRoles: ['user', 'assistant', 'system'],
  });
  return result.messages;
}

/**
 * Format timestamp to readable date string
 */
function formatTimestamp(timestamp: any): string {
  try {
    let date: Date;

    if (timestamp?.toDate) {
      date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else {
      return 'fecha desconocida';
    }

    return date.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return 'fecha desconocida';
  }
}

