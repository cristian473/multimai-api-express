import { Router } from 'express';
import * as controller from './ws.controller';

const router = Router();

// Webhook endpoint - no authentication required (WAHA will call this directly)
router.post('/webhook', controller.handleWebhook);

router.post('/multimai-webhook', controller.handleMultimaiWebhook);

router.post('/activate-agent', controller.handleActivateAgent);

export default router;


