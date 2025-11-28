import { Router } from 'express';
import { paddleController } from './paddle.controller';

const router = Router();

// Webhook endpoint - raw body is saved by express.json verify in server.ts
router.post('/webhook', paddleController.handleWebhook.bind(paddleController));

// Checkout endpoint
router.post('/checkout', paddleController.createCheckout.bind(paddleController));

// Get subscription for a user
router.get('/subscription/:uid', paddleController.getSubscription.bind(paddleController));

// Cancel subscription
router.post('/cancel', paddleController.cancelSubscription.bind(paddleController));

// Create customer portal session
router.post('/portal', paddleController.createPortalSession.bind(paddleController));

// Get available plans
router.get('/plans', paddleController.getPlans.bind(paddleController));

// Check subscription status
router.get('/status/:uid', paddleController.checkSubscriptionStatus.bind(paddleController));

export default router;

