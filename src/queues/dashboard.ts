import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getConversationQueue } from '../lib/queues/conversation-queue';

// Create Express adapter for Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

// Create Bull Board dashboard
const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
  queues: [new BullMQAdapter(getConversationQueue())],
  serverAdapter: serverAdapter,
});

export { serverAdapter, addQueue, removeQueue, setQueues, replaceQueues };
export default serverAdapter;
