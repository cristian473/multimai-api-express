import { wsProxyClient } from "../../other/wsProxyClient";
import { generateQuickWaitingMessage } from "../quick-response";
import { getHistory } from "../../utils/history";
import { ConversationContext } from "../types/context";
import { processSingleTextMessage } from "../../utils/response-processor";

export async function quickResponser(uid: string, userPhone: string, session: string, messages: ConversationContext['messages']) {
  try {
    const userMessage = messages.map(m => m.content).join(" ");
  
    // Get conversation history for context
    const history = await getHistory(uid, userPhone);
  
    // Generate quick response
    const quickResponse = await generateQuickWaitingMessage(
      userMessage,
      history.map(h => ({ role: h.role, content: h.content }))
    );
  
    if (quickResponse) {
      console.log("💬 Enviando respuesta rápida:", quickResponse);

      const messages = processSingleTextMessage(quickResponse.message);
  
      // Send quick response immediately
      await wsProxyClient.post(`/ws/send-message`, {
        chatId: userPhone,
        session: session,
        messages,
      });
  
      // Small pause after quick response
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.error("⚠️ Error generando/enviando respuesta rápida:", error);
    // Continue with normal flow even if quick response fails
  }
}
