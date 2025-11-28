/**
 * Sistema de cola de mensajes para WhatsApp con funcionalidad de debounce,
 * que acumula mensajes entrantes y los procesa en batch para la IA.
 * 
 * Features:
 * - Message accumulation with debounce timer
 * - Cancellation support: new messages abort current processing
 * - ExecutionContext for deferred actions and cleanup
 */

import { formatUserMessage } from './message-helpers';
import { ExecutionContext, createExecutionContext } from './execution-context';
import type { WhatsAppWebhookPayload } from '../../entities/ws/ws.dto';

/**
 * Configuration for message queue processing
 */
export const MESSAGE_QUEUE_CONFIG = {
  // Gap in milliseconds to wait before processing accumulated messages
  GAP_MILLISECONDS: process.env.MESSAGE_QUEUE_GAP_MILLISECONDS ? parseInt(process.env.MESSAGE_QUEUE_GAP_MILLISECONDS) : 5000,
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

/**
 * Callback context passed to the processing function
 */
export interface ProcessingContext {
  payload: AccumulatedMessagesPayload;
  executionContext: ExecutionContext;
}

/**
 * Callback type for message processing
 */
export type MessageProcessingCallback = (context: ProcessingContext) => Promise<void>;

interface UserQueue {
  messages: Message[];
  timer: NodeJS.Timeout | null;
  callback: MessageProcessingCallback | null;
  isProcessing: boolean;
  abortController: AbortController | null;
  currentExecutionContext: ExecutionContext | null;
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
 * Creates an empty user queue
 */
function createEmptyUserQueue(): UserQueue {
  return {
    messages: [],
    timer: null,
    callback: null,
    isProcessing: false,
    abortController: null,
    currentExecutionContext: null,
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
 * Creates a message queue with debouncing and cancellation functionality
 * 
 * Behavior:
 * - Messages are accumulated during the gap period
 * - When a new message arrives during processing, current processing is aborted
 * - Aborted processing triggers cleanup (delete messages with executionId)
 * - After abort cleanup, a new timer is started to reprocess accumulated messages
 * - Only on successful completion are pending actions executed
 */
export function createMessageQueue(config: QueueConfig) {
  const state: QueueState = createInitialState();

  /**
   * Starts a new processing timer for a user queue
   */
  function startProcessingTimer(from: string, callback: MessageProcessingCallback): void {
    const currentQueue = state.queues.get(from);
    if (!currentQueue) return;

    // Clear any existing timer
    if (currentQueue.timer) {
      clearTimeout(currentQueue.timer);
      currentQueue.timer = null;
    }

    console.log(`[MessageQueue] 🕐 Starting processing timer for ${from} (${config.gapMilliseconds}ms)`);

    currentQueue.timer = setTimeout(async () => {
      await processQueueForUser(from, callback);
    }, config.gapMilliseconds);

    state.queues.set(from, currentQueue);
  }

  /**
   * Main processing function for a user's queued messages
   */
  async function processQueueForUser(from: string, callback: MessageProcessingCallback): Promise<void> {
    const currentQueue = state.queues.get(from);
    if (!currentQueue || currentQueue.messages.length === 0) {
      console.log(`[MessageQueue] No messages to process for ${from}`);
      return;
    }

    // Don't start new processing if already processing
    if (currentQueue.isProcessing) {
      console.log(`[MessageQueue] Skipping - already processing for ${from}`);
      return;
    }

    // Create new AbortController and ExecutionContext for this processing cycle
    const abortController = new AbortController();
    const executionContext = createExecutionContext(abortController);

    // Set processing state
    currentQueue.isProcessing = true;
    currentQueue.abortController = abortController;
    currentQueue.currentExecutionContext = executionContext;
    currentQueue.timer = null; // Timer has fired
    state.queues.set(from, currentQueue);

    console.log(
      `[MessageQueue] 🚀 Processing ${currentQueue.messages.length} accumulated message(s) for ${from} [executionId: ${executionContext.executionId}]`
    );

    const accumulatedPayload = processQueue(currentQueue.messages);

    try {
      await callback({
        payload: accumulatedPayload,
        executionContext,
      });

      // Check if aborted during execution
      if (executionContext.isAborted()) {
        console.log(`[MessageQueue] ⚠️ Execution was aborted for ${from} - keeping messages in queue`);
        // Run cleanup (delete messages with this executionId)
        await executionContext.runCleanup();
        
        // Reset processing state but KEEP messages
        const queueAfterAbort = state.queues.get(from);
        if (queueAfterAbort) {
          queueAfterAbort.isProcessing = false;
          queueAfterAbort.abortController = null;
          queueAfterAbort.currentExecutionContext = null;
          // NOTE: Messages are kept in queue
          state.queues.set(from, queueAfterAbort);

          // CRITICAL: Start new timer to reprocess messages if there are any
          if (queueAfterAbort.messages.length > 0 && queueAfterAbort.callback) {
            console.log(`[MessageQueue] 🔄 Restarting timer to process ${queueAfterAbort.messages.length} message(s) for ${from}`);
            startProcessingTimer(from, queueAfterAbort.callback);
          }
        }
      } else {
        // SUCCESS: Execute pending actions and reset queue
        console.log(`[MessageQueue] ✅ Execution completed successfully for ${from}`);
        
        // Execute pending actions (like sending messages to owner)
        await executionContext.executePendingActions();

        // Reset queue completely
        state.queues.set(from, createEmptyUserQueue());
      }
    } catch (error) {
      console.error(`[MessageQueue] ❌ Error processing messages for ${from}:`, error);
      
      // Check if error was due to abort
      if (executionContext.isAborted()) {
        console.log(`[MessageQueue] Error was due to abort - running cleanup`);
        await executionContext.runCleanup();
        
        // Keep messages for retry
        const queueAfterError = state.queues.get(from);
        if (queueAfterError) {
          queueAfterError.isProcessing = false;
          queueAfterError.abortController = null;
          queueAfterError.currentExecutionContext = null;
          state.queues.set(from, queueAfterError);

          // CRITICAL: Start new timer to reprocess messages
          if (queueAfterError.messages.length > 0 && queueAfterError.callback) {
            console.log(`[MessageQueue] 🔄 Restarting timer after abort error for ${from}`);
            startProcessingTimer(from, queueAfterError.callback);
          }
        }
      } else {
        // Non-abort error - still run cleanup and reset
        await executionContext.runCleanup();
        state.queues.set(from, createEmptyUserQueue());
      }
    }
  }

  return function enqueueMessage(
    webhookPayload: WhatsAppWebhookPayload,
    callback: MessageProcessingCallback,
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
      userQueue = createEmptyUserQueue();
      state.queues.set(from, userQueue);
    }

    // CRITICAL: If currently processing, abort the current execution
    if (userQueue.isProcessing && userQueue.abortController) {
      console.log(`[MessageQueue] ⚠️ New message arrived during processing for ${from} - ABORTING current execution`);
      userQueue.abortController.abort();
      // The cleanup will happen in processQueueForUser and a new timer will be started
    }

    // Reset existing timer (if any) - we'll start a new one
    if (userQueue.timer) {
      clearTimeout(userQueue.timer);
      userQueue.timer = null;
    }

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

    console.log(`[MessageQueue] 📥 Enqueued message for ${from}. Total in queue: ${userQueue.messages.length}`);

    state.queues.set(from, userQueue);

    // Start processing timer (only if not currently processing)
    // If processing, the timer will be started after abort cleanup
    if (!userQueue.isProcessing) {
      startProcessingTimer(from, callback);
    } else {
      console.log(`[MessageQueue] ⏳ Message added to queue - will process after current execution aborts`);
    }
  };
}

/**
 * Legacy callback adapter for backward compatibility
 * Wraps old-style callbacks to work with new ExecutionContext system
 */
export function wrapLegacyCallback(
  legacyCallback: (payload: AccumulatedMessagesPayload) => Promise<void>
): MessageProcessingCallback {
  return async (context: ProcessingContext) => {
    // For legacy callbacks, we just ignore the ExecutionContext
    // This means no cancellation or pending action support
    await legacyCallback(context.payload);
  };
}
