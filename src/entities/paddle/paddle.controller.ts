import { Request, Response } from 'express';
import { paddleService } from './paddle.service';
import HttpStatusCodes from '../../constants/HttpStatusCodes';

class PaddleController {
  /**
   * POST /api/paddle/webhook
   * Handle Paddle webhooks
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const signature = req.headers['paddle-signature'] as string;
      
      if (!signature) {
        res.status(HttpStatusCodes.BAD_REQUEST).json({ 
          error: 'Missing paddle-signature header' 
        });
        return;
      }

      // Get raw body saved by express.json verify function
      const rawBody = (req as any).rawBody as string;
      
      if (!rawBody) {
        console.error('Raw body not found - middleware may not be configured correctly');
        res.status(HttpStatusCodes.BAD_REQUEST).json({ 
          error: 'Raw body not available' 
        });
        return;
      }

      await paddleService.processWebhook(rawBody, signature);

      // Always return 200 to acknowledge receipt
      res.status(HttpStatusCodes.OK).json({ received: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      // Still return 200 to prevent Paddle from retrying
      res.status(HttpStatusCodes.OK).json({ 
        received: true, 
        error: 'Error processing webhook' 
      });
    }
  }

  /**
   * POST /api/paddle/checkout
   * Create a checkout session
   */
  async createCheckout(req: Request, res: Response): Promise<void> {
    try {
      const { uid, priceId, customerEmail, discountCode } = req.body;

      if (!uid || !priceId) {
        res.status(HttpStatusCodes.BAD_REQUEST).json({ 
          error: 'Missing required fields: uid, priceId' 
        });
        return;
      }

      const result = await paddleService.createCheckout(
        uid, 
        priceId, 
        customerEmail, 
        discountCode
      );

      if (!result) {
        res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ 
          error: 'Failed to create checkout' 
        });
        return;
      }

      res.status(HttpStatusCodes.OK).json(result);
    } catch (error: any) {
      console.error('Create checkout error:', error);
      res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ 
        error: error.message || 'Failed to create checkout' 
      });
    }
  }

  /**
   * GET /api/paddle/subscription/:uid
   * Get subscription for a user
   */
  async getSubscription(req: Request, res: Response): Promise<void> {
    try {
      const { uid } = req.params;

      if (!uid) {
        res.status(HttpStatusCodes.BAD_REQUEST).json({ 
          error: 'Missing uid parameter' 
        });
        return;
      }

      const subscription = await paddleService.getSubscription(uid);

      res.status(HttpStatusCodes.OK).json({ subscription });
    } catch (error: any) {
      console.error('Get subscription error:', error);
      res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ 
        error: error.message || 'Failed to get subscription' 
      });
    }
  }

  /**
   * POST /api/paddle/cancel
   * Cancel a subscription
   */
  async cancelSubscription(req: Request, res: Response): Promise<void> {
    try {
      const { uid, effectiveFrom } = req.body;

      if (!uid) {
        res.status(HttpStatusCodes.BAD_REQUEST).json({ 
          error: 'Missing uid field' 
        });
        return;
      }

      await paddleService.cancelSubscription(uid, effectiveFrom);

      res.status(HttpStatusCodes.OK).json({ 
        success: true, 
        message: 'Subscription cancelled successfully' 
      });
    } catch (error: any) {
      console.error('Cancel subscription error:', error);
      res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ 
        error: error.message || 'Failed to cancel subscription' 
      });
    }
  }

  /**
   * POST /api/paddle/portal
   * Create a customer portal session
   */
  async createPortalSession(req: Request, res: Response): Promise<void> {
    try {
      const { uid } = req.body;

      if (!uid) {
        res.status(HttpStatusCodes.BAD_REQUEST).json({ 
          error: 'Missing uid field' 
        });
        return;
      }

      const result = await paddleService.createPortalSession(uid);

      if (!result) {
        res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ 
          error: 'Failed to create portal session' 
        });
        return;
      }

      res.status(HttpStatusCodes.OK).json(result);
    } catch (error: any) {
      console.error('Create portal session error:', error);
      res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ 
        error: error.message || 'Failed to create portal session' 
      });
    }
  }

  /**
   * GET /api/paddle/plans
   * Get available plans
   */
  async getPlans(req: Request, res: Response): Promise<void> {
    try {
      const plans = paddleService.getPlans();
      res.status(HttpStatusCodes.OK).json({ plans });
    } catch (error: any) {
      console.error('Get plans error:', error);
      res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ 
        error: error.message || 'Failed to get plans' 
      });
    }
  }

  /**
   * GET /api/paddle/status/:uid
   * Check if user has active subscription
   */
  async checkSubscriptionStatus(req: Request, res: Response): Promise<void> {
    try {
      const { uid } = req.params;

      if (!uid) {
        res.status(HttpStatusCodes.BAD_REQUEST).json({ 
          error: 'Missing uid parameter' 
        });
        return;
      }

      const hasActive = await paddleService.hasActiveSubscription(uid);
      const isExpired = await paddleService.isTrialExpired(uid);

      res.status(HttpStatusCodes.OK).json({ 
        hasActiveSubscription: hasActive,
        isTrialExpired: isExpired
      });
    } catch (error: any) {
      console.error('Check subscription status error:', error);
      res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ 
        error: error.message || 'Failed to check subscription status' 
      });
    }
  }
}

export const paddleController = new PaddleController();

