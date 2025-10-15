
import { aiWorkflow } from '../../utils/assistant/ai-workflow';
import { WhatsAppWebhookPayload } from './ws.dto';
import { hasToReply } from '../../utils/inactivateBot';
import { processResponse } from '../../utils/process-response';
import { wsProxyClient } from '../../other/wsProxyClient';

/**
 * Process incoming WhatsApp webhook payload
 * Currently just logs the message for debugging
 */
async function processWebhookResponse(webhookPayload: WhatsAppWebhookPayload): Promise<boolean> {
  if(!hasToReply(webhookPayload)) {
    return;
  }

  const {payload, metadata, session} = webhookPayload;

  const aiResponse = await aiWorkflow(metadata.uid, {
    userPhone: payload.from,
    message: payload.body,
    userName: payload._data.notifyName
  })

  const messages = processResponse(aiResponse.message);

  await wsProxyClient.post(`/ws/send-message`, {
    chatId: payload.from,
    session: session,
    messages: messages,
  })
}

export default {
  processWebhookResponse,
};


