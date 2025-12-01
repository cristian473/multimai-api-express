import { Request, Response } from 'express';
import HttpStatusCodes from '../../constants/HttpStatusCodes';
import wsService from './ws.service';
import { WhatsAppWebhookPayload, ActivateAgentRequest } from './ws.dto';
import { RouteError } from '../../other/errorHandler';

/**
 * Webhook endpoint to receive WhatsApp messages
 * Currently just logs the incoming messages
 */
export async function handleWebhook(req: Request, res: Response) {
  try {
    const payload: WhatsAppWebhookPayload = req.body;

    await wsService.processWebhookResponse(payload);

    res.status(HttpStatusCodes.OK).json({
      success: true,
      message: 'Webhook processed successfully'
    });
  } catch (error: any) {
    console.error('Error processing webhook:', error.response?.data);
    console.error('Error processing webhook:', error);
    throw new RouteError(HttpStatusCodes.INTERNAL_SERVER_ERROR, 'Internal server error while processing webhook');
  }
}

export async function handleMultimaiWebhook(req: Request, res: Response) {
  try {
    const payload: WhatsAppWebhookPayload = req.body;

    await wsService.processMultimaiWebhookResponse(payload);

    res.status(HttpStatusCodes.OK).send('EVENT_RECEIVED');
  } catch (error: any) {
    console.error('Error processing Multimai webhook:', error.response?.data);
    console.error('Error processing Multimai webhook:', error);
    throw new RouteError(HttpStatusCodes.INTERNAL_SERVER_ERROR, 'Internal server error while processing Multimai webhook');
  }
}

export async function handleActivateAgent(req: Request, res: Response) {
  try {
    const request: ActivateAgentRequest = req.body;
    
    // Validate required fields
    if (!request.uid || !request.session || !request.userPhone || !request.userName || !request.assistantMessage) {
      throw new RouteError(HttpStatusCodes.BAD_REQUEST, 'Missing required parameters');
    }

    const result = await wsService.processActivateAgent(request);

    res.status(HttpStatusCodes.OK).json(result);
  } catch (error: any) {
    console.error('Error processing activate agent:', error);
    throw new RouteError(HttpStatusCodes.INTERNAL_SERVER_ERROR, error.message || 'Internal server error while activating agent');
  }
}