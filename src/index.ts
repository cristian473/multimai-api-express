import 'module-alias/register';
import './pre-start'; // Must be the first import
import logger from 'jet-logger';
import server from './server';
import { initializeCronJobs } from './lib/cron/scheduler';
import {
  startConversationWorker,
  stopConversationWorker,
  closeConversationQueue,
  closeQueueConnection,
} from './lib/queues';

// **** Run **** //

const SERVER_START_MSG = 'Express server started on port: ' + process.env.PORT;

const startServer = async () => {
  try {
    // Start conversation close worker (sliding window)
    startConversationWorker();
    logger.info('Conversation worker initialized');

    // Initialize cron jobs
    initializeCronJobs();
    logger.info('Cron jobs initialized');

    server.listen(process.env.PORT || 8081, () => logger.info(SERVER_START_MSG));
  } catch (error) {
    logger.err('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Shutting down gracefully...');
  try {
    await stopConversationWorker();
    await closeConversationQueue();
    await closeQueueConnection();
    logger.info('Queues closed successfully');
    process.exit(0);
  } catch (error) {
    logger.err('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

startServer();

module.exports = server;

