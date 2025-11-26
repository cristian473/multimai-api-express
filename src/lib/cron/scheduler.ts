import cron from 'node-cron';
import logger from 'jet-logger';
import { processPaymentReminders } from './payment-reminders';
import { processOwnerReminders } from './owner-reminders';
import { notifyOwnersOnCompletion } from './notify-owners';
import { processLeadQualification } from './lead-qualification';

/**
 * Initializes all cron jobs
 */
export function initializeCronJobs(): void {
  logger.info('[Cron] Initializing cron jobs...');

  // Cron job for tenant payment reminders - runs every minute
  const paymentRemindersJob = cron.schedule('* * * * *', async () => {
    logger.info('[Cron] Starting payment reminders job...');

    try {
      const stats = await processPaymentReminders();
      logger.info('[Cron] Payment reminders job completed');
      logger.info(`Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}`);
    } catch (error) {
      logger.err('[Cron] Payment reminders job failed:', error);
    }
  });

  logger.info('[Cron] Payment reminders job scheduled (runs every minute)');

  // Cron job for owner reminders (bill uploads) - runs every minute
  const ownerRemindersJob = cron.schedule('* * * * *', async () => {
    logger.info('[Cron] Starting owner reminders job...');

    try {
      const stats = await processOwnerReminders();
      logger.info('[Cron] Owner reminders job completed');
      logger.info(`Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}, Locked: ${stats.locked}, Notified: ${stats.notified}`);
    } catch (error) {
      logger.err('[Cron] Owner reminders job failed:', error);
    }
  });

  const notifyOwnersJob = cron.schedule('* * * * *', async () => {
    logger.info('[Cron] Starting notify owners job...');
    try {
      const stats = await notifyOwnersOnCompletion();
      logger.info('[Cron] Notify owners job completed');
      logger.info(`Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}`);
    } catch (error) {
      logger.err('[Cron] Notify owners job failed:', error);
    }
  });

  logger.info('[Cron] Notify owners job scheduled (runs every minute)');

  // // Cron job for lead qualification - runs every 15 minutes
  // const leadQualificationJob = cron.schedule('*/15 * * * *', async () => {
  //   logger.info('[Cron] Starting lead qualification job...');

  //   try {
  //     const stats = await processLeadQualification();
  //     logger.info('[Cron] Lead qualification job completed');
  //     logger.info(`Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}`);
  //   } catch (error) {
  //     logger.err('[Cron] Lead qualification job failed:', error);
  //   }
  // });

  logger.info('[Cron] Lead qualification job scheduled (runs every 15 minutes)');

  // Optional: Run immediately on start (useful for testing)
  if (process.env.RUN_CRON_ON_START === 'true') {
    logger.info('[Cron] Running jobs immediately (RUN_CRON_ON_START=true)');

    processPaymentReminders()
      .then(stats => {
        logger.info('[Cron] Initial payment reminders job completed');
        logger.info(`Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}`);
      })
      .catch(error => {
        logger.err('[Cron] Initial payment reminders job failed:', error);
      });

    processOwnerReminders()
      .then(stats => {
        logger.info('[Cron] Initial owner reminders job completed');
        logger.info(`Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}, Locked: ${stats.locked}, Notified: ${stats.notified}`);
      })
      .catch(error => {
        logger.err('[Cron] Initial owner reminders job failed:', error);
      });

    notifyOwnersOnCompletion()
      .then(stats => {
        logger.info('[Cron] Initial notify owners job completed');
        logger.info(`Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}`);
      })
      .catch(error => {
        logger.err('[Cron] Initial notify owners job failed:', error);
      });
  }

  // Handle termination signals
  const gracefulShutdown = () => {
    logger.info('[Cron] Stopping all cron jobs...');
    paymentRemindersJob.stop();
    ownerRemindersJob.stop();
    notifyOwnersJob.stop();
    // leadQualificationJob.stop();
    logger.info('[Cron] All cron jobs stopped');
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

/**
 * Manually runs the payment reminders cron
 * Useful for testing or manual execution from an endpoint
 */
export async function runPaymentRemindersManually(): Promise<{
  success: boolean;
  stats?: { processed: number; succeeded: number; failed: number };
  error?: string;
}> {
  try {
    logger.info('[Cron] Manual execution of payment reminders job...');
    const stats = await processPaymentReminders();
    logger.info('[Cron] Manual execution completed');
    logger.info(`Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}`);

    return { success: true, stats };
  } catch (error) {
    logger.err('[Cron] Manual execution failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Manually runs the owner reminders cron
 * Useful for testing or manual execution from an endpoint
 */
export async function runOwnerRemindersManually(): Promise<{
  success: boolean;
  stats?: { processed: number; succeeded: number; failed: number; locked: number; notified: number };
  error?: string;
}> {
  try {
    logger.info('[Cron] Manual execution of owner reminders job...');
    const stats = await processOwnerReminders();
    logger.info('[Cron] Manual execution completed');
    logger.info(`Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}, Locked: ${stats.locked}, Notified: ${stats.notified}`);

    return { success: true, stats };
  } catch (error) {
    logger.err('[Cron] Manual execution failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
