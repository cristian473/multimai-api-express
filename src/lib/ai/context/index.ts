/**
 * AI Context Module
 * 
 * Centralizes all functions related to loading and managing context for LLM text generation.
 */

export {
  loadConversationForLLM,
  getMessagesForLLM,
  getConversationMessagesOnly,
  getFullConversationContext,
  type LLMMessage,
  type LoadConversationOptions,
  type LoadConversationResult,
} from './conversation-loader';

