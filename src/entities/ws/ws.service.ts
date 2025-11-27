/**
 * WhatsApp Service
 * Handles webhook processing and agent activation
 */

import { mainGuidelinesWorkflow } from '../../lib/ai/workflows/main-guidelines-workflow';
import { multimaiWorkflow } from '../../lib/ai/workflows/multimai-workflow';
import { WhatsAppWebhookPayload, ActivateAgentRequest } from './ws.dto';
import { extractCustomerNumber, hasToReply } from '../../lib/utils/inactivate-bot';
import { processResponse } from '../../lib/utils/response-processor';
import { wsProxyClient } from '../../lib/other/wsProxyClient';
import { createMessageQueue, MESSAGE_QUEUE_CONFIG } from '../../lib/utils/message-queue';
import { db } from '../../lib/db/firebase';
import { formatChatId, extractPhoneFromChatId } from '../../lib/utils/message-helpers';
import { withTypingIndicator } from '../../lib/utils/typing-indicator-helper';
import { sendSeen, startTyping, stopTyping } from '../../lib/utils/whatsapp-status-helpers';
import { shouldProcessWorkflow } from '../../lib/utils/validation';

// Create message queue instance with centralized configuration
const enqueueMessage = createMessageQueue({
  gapMilliseconds: MESSAGE_QUEUE_CONFIG.GAP_MILLISECONDS
});

/**
 * Sends WhatsApp messages to a chat
 */
async function sendMessages(session: string, chatId: string, messages: any[]): Promise<void> {
  await wsProxyClient.post(`/ws/send-message`, {
    chatId,
    session,
    messages,
  });
}

/**
 * Process incoming WhatsApp webhook payload with message batching
 */
async function processWebhookResponse(webhookPayload: WhatsAppWebhookPayload): Promise<boolean> {
  // Check if bot should reply
  const shouldReply = await hasToReply(webhookPayload);
  if (!shouldReply) {
    console.log("[Webhook] Bot should not reply");
    return false;
  }

  const customerNumber = extractCustomerNumber(webhookPayload);
  const isValid = await shouldProcessWorkflow(webhookPayload.metadata.uid as string, customerNumber);
  if (!isValid) {
    console.log("[Webhook] Customer should not process workflow");
    return false;
  }

  await sendSeen(webhookPayload);

  // Enqueue message for batch processing
  enqueueMessage(webhookPayload, async (accumulatedPayload) => {
    const { messages: accumulatedMessages, metadata, session, from } = accumulatedPayload;

    try {
      console.log('[Webhook] Processing accumulated messages:', accumulatedMessages.map(m => m.body).join(', '));

      const userPhone = extractPhoneFromChatId(from);

      await startTyping(webhookPayload);

      // Execute AI workflow
      const aiResponse = await mainGuidelinesWorkflow(metadata.uid, session, {
        userPhone,
        messages: accumulatedMessages,
        userName: accumulatedPayload.userName
      });

      if (!aiResponse) {
        console.log('[Webhook] ⚠️ No AI response generated');
        return;
      }

      // Process and send response
      const responseMessages = processResponse(aiResponse.message);
      console.log("[Webhook] Sending response with", responseMessages.length, "message(s)");

      await stopTyping(webhookPayload);
      await sendMessages(session, from, responseMessages);


      console.log('[Webhook] ✅ Message sent successfully');
    } catch (error) {
      console.error('[Webhook] ❌ Error processing accumulated messages:', error);
    }
  });

  return true;
}

/**
 * Process Multimai webhook with batching
 */
async function processMultimaiWebhookResponse(webhookPayload: WhatsAppWebhookPayload): Promise<boolean> {
  // Check if bot should reply
  const shouldReply = await hasToReply(webhookPayload);
  if (!shouldReply) {
    console.log("[MultimaiWebhook] Bot should not reply");
    return false;
  }

  await sendSeen(webhookPayload);

  // Enqueue message for batch processing
  enqueueMessage(webhookPayload, async (accumulatedPayload) => {
    const { messages: accumulatedMessages, session, from, userName } = accumulatedPayload;

    try {
      console.log('[MultimaiWebhook] Processing accumulated messages:', accumulatedMessages.map(m => m.body).join(', '));

      const userPhone = extractPhoneFromChatId(from);

      // Combine messages for Multimai
      const combinedMessage = accumulatedMessages.map(m => m.body).join(" ");

      await startTyping(webhookPayload);

      // Execute Multimai workflow
      const aiResponse = await multimaiWorkflow({
        userPhone,
        userName,
        message: combinedMessage,
        messageReferencesTo: accumulatedMessages[0]?.replyTo || undefined
      });

      if (!aiResponse) {
        console.log('[MultimaiWebhook] ⚠️ No AI response generated');
        return;
      }

      // Process and send response
      const responseMessages = processResponse(aiResponse.message);
      await stopTyping(webhookPayload);
      await sendMessages(session, from, responseMessages);

      console.log('[MultimaiWebhook] ✅ Message sent successfully');
    } catch (error) {
      console.error('[MultimaiWebhook] ❌ Error processing accumulated messages:', error);
    }
  });

  return true;
}

/**
 * Activates agent after owner response
 */
async function processActivateAgent(request: ActivateAgentRequest): Promise<any> {
  const { uid, session, userPhone, userName, assistantMessage, replyToMessageId, reminderId } = request;

  console.log("[ActivateAgent] Reactivating agent after owner response");
  console.log("[ActivateAgent] Customer:", userName, userPhone);

  const chatId = formatChatId(userPhone);

  try {
    // Execute workflow with typing indicator
    const aiResponse = await withTypingIndicator(session, chatId, async () => {
      return await mainGuidelinesWorkflow(uid, session, {
        userPhone,
        message: "",
        userName,
        assistantMessage,
      }, { isFromActivateAgent: true });
    });

    if (!aiResponse) {
      console.log("[ActivateAgent] ⚠️ No AI response generated");
      return { success: true, message: "Agent activated but no response generated" };
    }

    // Process response
    const messages = processResponse(aiResponse.message);

    // Build send message body
    const sendMessageBody: any = {
      chatId,
      session,
      messages,
    };

    // Add reply_to to first message if provided
    if (replyToMessageId && messages.length > 0) {
      const [firstMessage, ...restOfMessages] = messages;
      sendMessageBody.messages = [
        {
          ...firstMessage,
          reply_to: replyToMessageId
        },
        ...restOfMessages
      ];
    }

    // Send messages
    await wsProxyClient.post(`/ws/send-message`, sendMessageBody);

    // Update reminder status if provided
    if (reminderId) {
      try {
        await db.collection(`users/${uid}/reminders`).doc(reminderId).update({
          status: 'sent',
          sentAt: new Date(),
        });
      } catch (reminderError: any) {
        console.error("[ActivateAgent] ⚠️ Error updating reminder status:", reminderError.message);
      }
    }

    return {
      success: true,
      message: "Agent activated and response sent successfully",
      reminderProcessed: !!reminderId,
    };
  } catch (error) {
    console.error("[ActivateAgent] ❌ Error:", error);
    throw error;
  }
}

export default {
  processWebhookResponse,
  processMultimaiWebhookResponse,
  processActivateAgent,
};
