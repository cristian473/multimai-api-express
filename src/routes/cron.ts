import { Router, Request, Response } from 'express';
import { runPaymentRemindersManually, runOwnerRemindersManually } from '../lib/cron/scheduler';
import logger from 'jet-logger';

const cronRouter = Router();

/**
 * Endpoint para ejecutar manualmente el cron de recordatorios de pago
 * Útil para testing o ejecución manual
 *
 * @route POST /cron/payment-reminders/run
 * @security Requiere CRON_SECRET en header Authorization
 */
cronRouter.post('/payment-reminders/run', async (req: Request, res: Response) => {
  try {
    // Verificar autorización
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (!process.env.CRON_SECRET) {
      logger.warn('[Cron API] CRON_SECRET not configured');
      return res.status(500).json({
        success: false,
        error: 'CRON_SECRET not configured',
      });
    }

    if (authHeader !== expectedAuth) {
      logger.warn('[Cron API] Unauthorized request attempt');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    logger.info('[Cron API] Manual execution requested');

    // Ejecutar el cron manualmente
    const result = await runPaymentRemindersManually();

    if (result.success) {
      return res.json({
        success: true,
        message: 'Payment reminders processed successfully',
        stats: result.stats,
        timestamp: new Date().toISOString(),
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    logger.err('[Cron API] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * Endpoint para ejecutar manualmente el cron de notificación a dueños
 * Útil para testing o ejecución manual
 *
 * @route POST /cron/notify-owners/run
 * @security Requiere CRON_SECRET en header Authorization
 */
cronRouter.post('/notify-owners/run', async (req: Request, res: Response) => {
  try {
    // Verificar autorización
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (!process.env.CRON_SECRET) {
      logger.warn('[Cron API] CRON_SECRET not configured');
      return res.status(500).json({
        success: false,
        error: 'CRON_SECRET not configured',
      });
    }

    if (authHeader !== expectedAuth) {
      logger.warn('[Cron API] Unauthorized request attempt');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    logger.info('[Cron API] Manual execution of notify owners requested');

    // Ejecutar el cron manualmente
    const result = await runOwnerRemindersManually();

    if (result.success) {
      return res.json({
        success: true,
        message: 'Owner notifications processed successfully',
        stats: result.stats,
        timestamp: new Date().toISOString(),
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    logger.err('[Cron API] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * Endpoint de health check para el cron
 *
 * @route GET /cron/health
 */
cronRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    cron: 'payment-reminders, owner-reminders, notify-owners',
    schedule: 'Payment reminders: every minute, Owner reminders: every minute, Notify owners: every 5 minutes',
    timezone: 'America/Argentina/Buenos_Aires',
  });
});

export default cronRouter;
