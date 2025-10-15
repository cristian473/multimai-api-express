import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
// import { messageQueue } from './messageQueue';

// // Crear el adaptador de Express para Bull Board
// const serverAdapter = new ExpressAdapter();
// serverAdapter.setBasePath('/admin/queues');

// // Crear el dashboard de Bull Board
// const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
//   queues: [
//     new BullMQAdapter(messageQueue),
//   ],
//   serverAdapter: serverAdapter,
// });

// export { serverAdapter, addQueue, removeQueue, setQueues, replaceQueues };
// export default serverAdapter;
