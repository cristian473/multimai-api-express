/**
 * Sistema de cola de mensajes para WhatsApp con funcionalidad de debounce,
 * que acumula mensajes entrantes y los procesa en batch para la IA.
 */

import { formatUserMessage } from './message-helpers';
import type { WhatsAppWebhookPayload } from '../../entities/ws/ws.dto';

/**
 * Configuration for message queue processing
 */
export const MESSAGE_QUEUE_CONFIG = {
  // Gap in milliseconds to wait before processing accumulated messages
  GAP_MILLISECONDS: 5000,
} as const;

interface Message {
  text: string;
  timestamp: number;
  webhookPayload: WhatsAppWebhookPayload;
}

interface QueueConfig {
  gapMilliseconds: number;
}

/**
 * Payload con array de mensajes acumulados
 */
export interface AccumulatedMessagesPayload {
  messages: Array<{
    id: string;
    body: string;
    timestamp: number;
    replyTo: string | null;
  }>;
  metadata: Record<string, any>;
  session: string;
  from: string;
  userName: string;
}

interface UserQueue {
  messages: Message[];
  timer: NodeJS.Timeout | null;
  callback: ((accumulatedPayload: AccumulatedMessagesPayload) => void) | null;
  isProcessing: boolean; // Mutex flag
}

interface QueueState {
  queues: Map<string, UserQueue>;
}

/**
 * Creates initial empty queue state
 */
function createInitialState(): QueueState {
  return {
    queues: new Map(),
  };
}

/**
 * Clears and resets timer for a user queue
 */
function resetTimer(userQueue: UserQueue): UserQueue {
  if (userQueue.timer) {
    clearTimeout(userQueue.timer);
  }
  return { ...userQueue, timer: null };
}

/**
 * Processes accumulated messages and creates payload
 */
function processQueue(messages: Message[]): AccumulatedMessagesPayload {
  const basePayload = messages[0].webhookPayload;

  return {
    messages: messages.map((msg) => ({
      id: msg.webhookPayload.payload.id,
      body: msg.text,
      timestamp: msg.timestamp,
      replyTo: msg.webhookPayload.payload.replyTo?.body || null,
    })),
    metadata: basePayload.metadata,
    session: basePayload.session,
    from: basePayload.payload.from,
    userName: basePayload.payload._data.pushName,
  };
}

/**
 * Wrapper for formatUserMessage to maintain backward compatibility
 * @deprecated Use formatUserMessage from message-helpers.ts directly
 */
export function getUserMessage(
  message: string,
  messageReferencesTo: string | null,
  messageReferencesToProduct: { title: string; description: string } | null,
  userName: string
): string {
  return formatUserMessage(message, messageReferencesTo, messageReferencesToProduct, userName);
}

/**
 * Creates a message queue with debouncing functionality
 */
export function createMessageQueue(config: QueueConfig) {
  const state: QueueState = createInitialState();

  return function enqueueMessage(
    webhookPayload: WhatsAppWebhookPayload,
    callback: (accumulatedPayload: AccumulatedMessagesPayload) => void,
  ): void {
    const from = webhookPayload.payload.from;
    const messageBody = webhookPayload.payload.body;

    // Validate payload
    if (!from || !messageBody) {
      console.error("[MessageQueue] Invalid webhook payload - missing from or body");
      return;
    }

    // Get or create user queue
    let userQueue = state.queues.get(from);
    if (!userQueue) {
      userQueue = {
        messages: [],
        timer: null,
        callback: null,
        isProcessing: false
      };
      state.queues.set(from, userQueue);
    }

    // Check if already processing (mutex)
    if (userQueue.isProcessing) {
      console.log(`[MessageQueue] Queue for ${from} is currently processing, enqueueing message`);
      // Still add message to queue, it will be processed in next batch
    }

    // Reset existing timer
    userQueue = resetTimer(userQueue);

    // Format and add message
    const formattedMessage = formatUserMessage(
      messageBody,
      webhookPayload.payload.replyTo?.body || null,
      null,
      webhookPayload.payload._data.pushName
    );

    userQueue.messages.push({
      text: formattedMessage,
      timestamp: Date.now(),
      webhookPayload,
    });
    userQueue.callback = callback;

    console.log(`[MessageQueue] Enqueued message for ${from}. Total in queue: ${userQueue.messages.length}`);

    // Set new timer for batch processing
    userQueue.timer = setTimeout(() => {
      const currentQueue = state.queues.get(from);
      if (!currentQueue || currentQueue.messages.length === 0) {
        return;
      }

      // Set processing flag (mutex)
      currentQueue.isProcessing = true;

      console.log(
        `[MessageQueue] Processing ${currentQueue.messages.length} accumulated message(s) for ${from}`
      );

      const accumulatedPayload = processQueue(currentQueue.messages);

      // Execute callback
      if (currentQueue.callback) {
        Promise.resolve(currentQueue.callback(accumulatedPayload))
          .catch((error: Error) => {
            console.error(`[MessageQueue] Error processing messages for ${from}:`, error);
          })
          .finally(() => {
            // Reset queue after processing
            state.queues.set(from, {
              messages: [],
              timer: null,
              callback: null,
              isProcessing: false
            });
          });
      } else {
        // No callback, just reset
        state.queues.set(from, {
          messages: [],
          timer: null,
          callback: null,
          isProcessing: false
        });
      }
    }, config.gapMilliseconds);

    state.queues.set(from, userQueue);
  };
}
