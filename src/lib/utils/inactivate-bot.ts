/**
 * Bot Inactivation Logic
 * Determines when the bot should reply vs when a human is handling the conversation
 */

import { saveConversationMessage } from "../db/repositories";
import { WhatsAppWebhookPayload } from '../../entities/ws/ws.dto';
import {
  temporalBlockManager,
  buildConversationKey,
  TEMPORAL_BLOCK_CONFIG
} from './temporal-block-manager';
import { extractPhoneFromChatId } from './message-helpers';

export function extractCustomerNumber(webhookPayload: WhatsAppWebhookPayload): string {
  const { payload } = webhookPayload;
  return payload.fromMe 
      ? extractPhoneFromChatId(payload._data.key.remoteJid) 
      : extractPhoneFromChatId(payload.from);
}

/**
 * Determines if the bot should reply to this webhook payload
 * Returns false if:
 * - Message is from bot itself
 * - Human owner is currently handling the conversation
 * @param webhookPayload - Incoming webhook payload
 * @returns true if bot should reply, false otherwise
 */
export async function hasToReply(webhookPayload: WhatsAppWebhookPayload): Promise<boolean> {
  const { payload, session, metadata, event } = webhookPayload;

  // Handle missing or undefined event
  if(!event || !event.includes('message')) {
    return false;
  }

  // Check if message is from bot or human
  const isBotMessage = payload.fromMe && payload.source === 'api';
  const isHumanOwnerMessage = payload.fromMe && payload.source !== 'api';

  // Extract customer number
  const customerNumber = extractCustomerNumber(webhookPayload);

  const conversationKey = buildConversationKey(session, customerNumber);

  // Bot talking to customer - don't reply
  if (isBotMessage) {
    console.log('[hasToReply] Bot message detected, skipping');
    return false;
  }

  // Human owner is responding - block bot and save message
  if (isHumanOwnerMessage) {
    console.log('[hasToReply] Human owner message detected');

    // Set temporal block to prevent bot interference
    temporalBlockManager.setBlock(
      conversationKey,
      TEMPORAL_BLOCK_CONFIG.HUMAN_INTERVENTION_DURATION
    );

    // Save owner's message as assistant message
    await saveConversationMessage(
      metadata.uid as string,
      customerNumber,
      'assistant',
      payload.body
    );

    return false;
  }

  // Check if conversation is currently blocked (human handling it)
  if (temporalBlockManager.isBlocked(conversationKey)) {
    console.log('[hasToReply] Conversation is blocked (human handling)');

    // Refresh block duration
    temporalBlockManager.setBlock(
      conversationKey,
      TEMPORAL_BLOCK_CONFIG.HUMAN_INTERVENTION_DURATION
    );

    // Save customer message
    await saveConversationMessage(
      metadata.uid as string,
      customerNumber,
      'user',
      payload.body
    );

    return false;
  }

  // Bot should reply
  console.log('[hasToReply] Bot should reply');
  return true;
}
