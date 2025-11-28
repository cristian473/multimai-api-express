/**
 * Workflow Helper Functions
 * Extract common workflow logic to reusable functions
 */

import { validateAiHasToResponse, ChatConfig } from "../../utils/validation";
import {
  getCustomerByPhone,
  createCustomer,
} from "../../db/repositories/customers";
import {
  saveConversationMessage,
  generateContextSummary,
} from "../../db/repositories/conversations";
import {
  getUserConfig,
  updateUserAgentConfig,
} from "../../db/repositories/users";
import { buildConversationContext } from "../../utils/conversation-helpers";
import { combineMessages } from "../../utils/message-helpers";
import type { ConversationContext } from "../types/context";
import type { ConversationMessage } from "../../db/types";
import { loadConversationForLLM } from "../context/conversation-loader";
import type { LLMMessage } from "../context/conversation-loader";

/**
 * Initial validation for AI workflow
 */
export async function validateWorkflowInput(
  uid: string,
  body: ChatConfig
): Promise<boolean> {
  const { message, messages, assistantMessage } = body;

  // Check if there's any content to process
  if (!message && (!messages || messages.length === 0) && !assistantMessage) {
    console.log("[WorkflowValidation] No message content provided");
    return false;
  }

  // Only validate AI response if there's a user message
  if (message || (messages && messages.length > 0)) {
    const aiHasToResponse = await validateAiHasToResponse(uid, body);

    if (!aiHasToResponse) {
      console.log("[WorkflowValidation] AI should not respond");
      return false;
    }
  }

  return true;
}

/**
 * Get or create customer
 */
export async function ensureCustomer(uid: string, userPhone: string, userName: string) {
  let customer = await getCustomerByPhone(uid, userPhone);

  if (!customer) {
    console.log("[WorkflowHelper] Creating new customer:", userName);
    customer = await createCustomer(uid, userPhone, {
      name: userName,
      phone: userPhone,
    });
  }

  return customer;
}

/**
 * Get user configuration and ensure session
 */
export async function ensureUserConfig(uid: string, session: string) {
  console.log('Ensuring user config for uid:', uid);
  const userConfig = await getUserConfig(uid);
  console.log('userConfig', userConfig);

  if (!userConfig) {
    console.log("[WorkflowHelper] User config not found");
    return null;
  }

  // Assign session if not exists
  if (session && !userConfig.config.session) {
    await updateUserAgentConfig(uid, { session });
  }

  return userConfig;
}

/**
 * Save messages to conversation history
 * @param executionId - Optional execution ID for tracking and potential rollback
 */
export async function saveMessages(
  uid: string,
  userPhone: string,
  body: ChatConfig,
  executionId?: string
): Promise<void> {
  const { assistantMessage, messages, message, userName } = body;

  // Save assistant message first if provided
  if (assistantMessage) {
    console.log("[WorkflowHelper] Saving assistant message from owner");
    await saveConversationMessage(
      uid, 
      userPhone, 
      'assistant', 
      assistantMessage,
      undefined, // messageId
      undefined, // isContext
      undefined, // customerName
      executionId
    );
  }

  // Save array of messages with IDs
  if (messages && messages.length > 0) {
    console.log(`[WorkflowHelper] Saving ${messages.length} user messages with IDs`);
    for (const msg of messages) {
      const messageContent = msg.replyTo
        ? `(hace referencia al mensaje: "${msg.replyTo}") ${msg.body}`
        : msg.body;

      await saveConversationMessage(
        uid, 
        userPhone, 
        'user', 
        messageContent, 
        msg.id,
        undefined, // isContext
        undefined, // customerName
        executionId
      );
    }
  }
  // Save single message (backward compatibility)
  else if (message) {
    console.log("[WorkflowHelper] Saving single user message");
    await saveConversationMessage(
      uid, 
      userPhone, 
      'user', 
      message,
      undefined, // messageId
      undefined, // isContext
      undefined, // customerName
      executionId
    );
  }
}

/**
 * Determine message to process
 */
export function determineMessageToProcess(body: ChatConfig): string {
  const { messages, message, assistantMessage } = body;

  if (messages && messages.length > 0) {
    // Combine multiple messages
    const combined = combineMessages(messages.map(m => m.body));
    console.log(`[WorkflowHelper] Processing ${messages.length} combined messages`);
    return combined;
  }

  if (message) {
    console.log('[WorkflowHelper] Processing single user message');
    return message;
  }

  if (assistantMessage) {
    // Special case: agent activation after owner response
    console.log('[WorkflowHelper] Processing agent activation');
    return '[AGENT_ACTIVATION_AFTER_OWNER_RESPONSE]';
  }

  return '';
}

/**
 * Get conversation context with history
 */
export async function getConversationContext(
  uid: string,
  userPhone: string,
  session: string
): Promise<{ context: ConversationContext; history: LLMMessage[] }> {
  const {messages} = await loadConversationForLLM(uid, userPhone);
  console.log(`[WorkflowHelper] History loaded: ${messages.length} messages`);

  const context = buildConversationContext(messages, uid, session);

  return { context, history: messages };
}

/**
 * Generate execution context summary
 */
export async function getExecutionContextSummary(
  uid: string,
  userPhone: string,
  messageToProcess: string,
  history: ConversationMessage[],
  threshold: number = 0.6
): Promise<string | null> {
  console.log('[WorkflowHelper] Generating execution context summary...');

  const contextResult = await generateContextSummary(
    uid,
    userPhone,
    messageToProcess,
    history,
    threshold
  );

  console.log(`[WorkflowHelper] Context relevance: ${contextResult.relevanceScore.toFixed(2)}`);
  console.log(`[WorkflowHelper] Reason: ${contextResult.reason}`);
  console.log(`[WorkflowHelper] Tools executed: ${contextResult.toolsExecuted.join(', ') || 'none'}`);

  if (contextResult.shouldApply) {
    console.log('[WorkflowHelper] Execution context will be applied');
    return contextResult.summary;
  }

  console.log('[WorkflowHelper] No relevant execution context');
  return null;
}
