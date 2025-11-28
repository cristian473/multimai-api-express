/**
 * WhatsApp Service
 * Handles webhook processing and agent activation
 * 
 * Features:
 * - Message batching with debounce
 * - Cancellation support: new messages abort current processing
 * - ExecutionContext for deferred actions and cleanup
 */

import { mainGuidelinesWorkflow } from '../../lib/ai/workflows/main-guidelines-workflow';
import { multimaiWorkflow } from '../../lib/ai/workflows/multimai-workflow';
import { WhatsAppWebhookPayload, ActivateAgentRequest } from './ws.dto';
import { extractCustomerNumber, hasToReply } from '../../lib/utils/inactivate-bot';
import { processResponse } from '../../lib/utils/response-processor';
import { wsProxyClient } from '../../lib/other/wsProxyClient';
import { createMessageQueue, MESSAGE_QUEUE_CONFIG, ProcessingContext } from '../../lib/utils/message-queue';
import { db } from '../../lib/db/firebase';
import { formatChatId, extractPhoneFromChatId } from '../../lib/utils/message-helpers';
import { withTypingIndicator } from '../../lib/utils/typing-indicator-helper';
import { sendSeen, startTyping, stopTyping } from '../../lib/utils/whatsapp-status-helpers';
import { shouldProcessWorkflow } from '../../lib/utils/validation';
import { createMessageCleanupFn } from '../../lib/db/repositories/conversations';

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
 * Now supports cancellation and ExecutionContext for deferred actions
 */
async function processWebhookResponse(webhookPayload: WhatsAppWebhookPayload): Promise<boolean> {
  // Check if bot should reply
  const shouldReply = await hasToReply(webhookPayload);
  if (!shouldReply) {
    console.log("[Webhook] Bot should not reply");
    return false;
  }

  const customerNumber = extractCustomerNumber(webhookPayload);
  const uid = webhookPayload.metadata.uid as string;
  
  const isValid = await shouldProcessWorkflow(uid, customerNumber);
  if (!isValid) {
    console.log("[Webhook] Customer should not process workflow");
    return false;
  }

  await sendSeen(webhookPayload);

  // Enqueue message for batch processing with ExecutionContext
  enqueueMessage(webhookPayload, async (context: ProcessingContext) => {
    const { payload, executionContext } = context;
    const { messages: accumulatedMessages, metadata, session, from } = payload;
    const userPhone = extractPhoneFromChatId(from);

    // Set up cleanup function for abort scenarios
    executionContext.setCleanupFn(createMessageCleanupFn(metadata.uid, userPhone));

    try {
      console.log(`[Webhook] Processing accumulated messages [executionId: ${executionContext.executionId}]:`, 
        accumulatedMessages.map(m => m.body).join(', '));

      // Check if aborted before starting
      if (executionContext.isAborted()) {
        console.log('[Webhook] ⚠️ Execution aborted before processing');
        return;
      }

      await startTyping(webhookPayload);

      // Execute AI workflow with ExecutionContext
      const aiResponse = await mainGuidelinesWorkflow(metadata.uid, session, {
        userPhone,
        messages: accumulatedMessages,
        userName: payload.userName
      }, undefined, executionContext);

      // Check if aborted after workflow
      if (executionContext.isAborted()) {
        console.log('[Webhook] ⚠️ Execution aborted after workflow - not sending response');
        await stopTyping(webhookPayload);
        return;
      }

      if (!aiResponse) {
        console.log('[Webhook] ⚠️ No AI response generated');
        await stopTyping(webhookPayload);
        return;
      }

      // Process and send response
      const responseMessages = processResponse(aiResponse.message);
      console.log("[Webhook] Sending response with", responseMessages.length, "message(s)");

      await stopTyping(webhookPayload);
      
      // Final check before sending
      if (executionContext.isAborted()) {
        console.log('[Webhook] ⚠️ Execution aborted before sending - discarding response');
        return;
      }

      await sendMessages(session, from, responseMessages);

      console.log('[Webhook] ✅ Message sent successfully');
    } catch (error) {
      console.error('[Webhook] ❌ Error processing accumulated messages:', error);
      await stopTyping(webhookPayload).catch(() => {});
      throw error; // Re-throw to let the queue handle cleanup
    }
  });

  return true;
}

/**
 * Process Multimai webhook with batching and cancellation support
 */
async function processMultimaiWebhookResponse(webhookPayload: WhatsAppWebhookPayload): Promise<boolean> {
  // Check if bot should reply
  const shouldReply = await hasToReply(webhookPayload);
  if (!shouldReply) {
    console.log("[MultimaiWebhook] Bot should not reply");
    return false;
  }

  await sendSeen(webhookPayload);

  // Enqueue message for batch processing with ExecutionContext
  enqueueMessage(webhookPayload, async (context: ProcessingContext) => {
    const { payload, executionContext } = context;
    const { messages: accumulatedMessages, session, from, userName } = payload;
    const userPhone = extractPhoneFromChatId(from);

    // Note: Multimai doesn't use per-user conversations, so no cleanup needed
    // But we still pass the executionContext for potential future use

    try {
      console.log(`[MultimaiWebhook] Processing accumulated messages [executionId: ${executionContext.executionId}]:`, 
        accumulatedMessages.map(m => m.body).join(', '));

      // Check if aborted before starting
      if (executionContext.isAborted()) {
        console.log('[MultimaiWebhook] ⚠️ Execution aborted before processing');
        return;
      }

      // Combine messages for Multimai
      const combinedMessage = accumulatedMessages.map(m => m.body).join(" ");

      await startTyping(webhookPayload);

      // Execute Multimai workflow with ExecutionContext
      const aiResponse = await multimaiWorkflow({
        userPhone,
        userName,
        message: combinedMessage,
        messageReferencesTo: accumulatedMessages[0]?.replyTo || undefined
      }, executionContext);

      // Check if aborted after workflow
      if (executionContext.isAborted()) {
        console.log('[MultimaiWebhook] ⚠️ Execution aborted after workflow - not sending response');
        await stopTyping(webhookPayload);
        return;
      }

      if (!aiResponse) {
        console.log('[MultimaiWebhook] ⚠️ No AI response generated');
        await stopTyping(webhookPayload);
        return;
      }

      // Process and send response
      const responseMessages = processResponse(aiResponse.message);
      await stopTyping(webhookPayload);
      
      // Final check before sending
      if (executionContext.isAborted()) {
        console.log('[MultimaiWebhook] ⚠️ Execution aborted before sending - discarding response');
        return;
      }

      await sendMessages(session, from, responseMessages);

      console.log('[MultimaiWebhook] ✅ Message sent successfully');
    } catch (error) {
      console.error('[MultimaiWebhook] ❌ Error processing accumulated messages:', error);
      await stopTyping(webhookPayload).catch(() => {});
      throw error; // Re-throw to let the queue handle cleanup
    }
  });

  return true;
}

/**
 * Activates agent after owner response
 * Note: This doesn't use the message queue, so no cancellation support needed
 */
async function processActivateAgent(request: ActivateAgentRequest): Promise<any> {
  const { uid, session, userPhone, userName, assistantMessage, replyToMessageId, reminderId } = request;

  console.log("[ActivateAgent] Reactivating agent after owner response");
  console.log("[ActivateAgent] Customer:", userName, userPhone);

  const chatId = formatChatId(userPhone);

  try {
    // Execute workflow with typing indicator
    // Note: ActivateAgent doesn't need ExecutionContext since it's not queued
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
