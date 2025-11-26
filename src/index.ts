import 'module-alias/register';
import './pre-start'; // Must be the first import
import logger from 'jet-logger';
import server from './server';
import { initializeCronJobs } from './lib/cron/scheduler';
// import { startMessageWorker } from './queues/messageWorker';

// **** Run **** //

const SERVER_START_MSG = ('Express server started on port: ' + process.env.PORT);

const startServer = async () => {
  try {
    // Iniciar el worker de la queue de mensajes
    // startMessageWorker();
    logger.info('Message worker initialized');

    // Inicializar cron jobs
    initializeCronJobs();
    logger.info('Cron jobs initialized');

    server.listen(process.env.PORT || 8081, () => logger.info(SERVER_START_MSG));
  } catch (error) {
    logger.err('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = server;

