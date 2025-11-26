import {
  getTodayConversationMessages,
  getPreviousConversationSummaries,
  getMultimaiMessages
} from '../db/repositories/conversations';

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  chat_message_id?: string;
}

export async function getHistory(uid: string, userPhone: string): Promise<ChatMessage[]> {
  let conversationHistory: ChatMessage[] = [];

  // Load today's messages
  const todayMessages = await getTodayConversationMessages(uid, userPhone);

  if (todayMessages.length > 0) {
    console.log(`Loaded ${todayMessages.length} messages from today`);
    conversationHistory = todayMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  } else {
    // Load previous conversation summaries
    console.log('No messages from today, loading previous conversation summaries');
    const previousSummaries = await getPreviousConversationSummaries(uid, userPhone, 5);

    if (previousSummaries.length > 0) {
      const summariesContext = previousSummaries
        .filter(s => s.summary && s.summary.trim() !== '')
        .map(s => `Resumen de conversación del ${s.date}: ${s.summary}`)
        .join('\n');

      if (summariesContext) {
        conversationHistory.push({
          role: 'system',
          content: `Contexto de conversaciones anteriores:\n${summariesContext}`
        });
      }
    }
  }

  return conversationHistory;
}

export async function getMultimaiHistory(userPhone: string): Promise<ChatMessage[]> {
  let conversationHistory: ChatMessage[] = [];

  try {
    const messages = await getMultimaiMessages(userPhone, 50);

    if (messages.length > 0) {
      console.log(`Loaded ${messages.length} messages from multimai agent`);
      conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        chat_message_id: msg.chat_message_id
      }));
    } else {
      console.log('No messages found in multimai agent collection');
    }
  } catch (error) {
    console.error('Error loading multimai history:', error);
  }

  return conversationHistory;
}
