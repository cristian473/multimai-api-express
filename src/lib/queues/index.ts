/**
 * Queues module exports
 */

export {
  getQueueConnection,
  closeQueueConnection,
} from './redis-connection';

export {
  CONVERSATION_QUEUE_NAME,
  CONVERSATION_TIMEOUT_MS,
  MIN_MESSAGES_FOR_SUMMARY,
  getConversationQueue,
  scheduleConversationClose,
  cancelConversationClose,
  startConversationWorker,
  stopConversationWorker,
  closeConversationQueue,
} from './conversation-queue';


