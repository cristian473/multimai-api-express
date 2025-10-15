import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import OpenAI from 'openai';

// Define the message structure
interface ChatMessage {
  role: string;
  message: string;
}

// Schema for conversation summary
const summarySchema = z.object({
  summary: z.string(),
  main_topics: z.array(z.string()),
  last_intent: z.string()
});

const summaryOutputParser = new JsonOutputParser<z.infer<typeof summarySchema>>();

const conversationSummaryTemplate = PromptTemplate.fromTemplate(`
Sistema de resumen de conversaciones.
Analiza el siguiente historial de mensajes y genera un resumen conciso que capture la esencia 
de la conversación y la intención del usuario.

Formato de respuesta JSON requerido:
{
  "summary": string,       // Resumen conciso de la conversación
  "main_topics": string[], // Temas principales discutidos
  "last_intent": string   // Última intención clara del usuario
}

Historial de mensajes:
{messages}

Analiza y responde SOLO con el objeto JSON según el formato especificado.
`);

async function formatConversationHistory(messages: ChatMessage[]) {
  try {
    // Format messages into a readable string
    const formattedHistory = messages.map(msg => {
      const roleLabel = msg.role === 'user' ? 'Usuario' : 'Agente';
      return `${roleLabel}: ${msg.message}`;
    }).join('\n');

    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-4o-mini',
      temperature: 0.1
    });

    const chain = conversationSummaryTemplate
      .pipe(model)
      .pipe(summaryOutputParser);

    const summary = await chain.invoke({
      messages: formattedHistory
    });

    // Validate the summary structure
    const validatedSummary = summarySchema.parse(summary);

    // Create a formatted history string suitable for routing
    const formattedSummary = [
      `RESUMEN: ${validatedSummary.summary}`,
      `TEMAS PRINCIPALES: ${validatedSummary.main_topics.join(', ')}`,
      `ÚLTIMA INTENCIÓN: ${validatedSummary.last_intent}`,
      '---',
      'ÚLTIMOS 3 MENSAJES:',
      ...messages.slice(-3).map(msg => {
        const roleLabel = msg.role === 'user' ? 'Usuario' : 'Agente';
        return `${roleLabel}: ${msg.message}`;
      })
    ];

    return formattedSummary;
  } catch (error) {
    console.error("Error formatting conversation history:", error);
    // If there's an error, return a basic format of the last 3 messages
    return messages.slice(-3).map(msg => {
      const roleLabel = msg.role === 'user' ? 'Usuario' : 'Agente';
      return `${roleLabel}: ${msg.message}`;
    });
  }
}




// Define the message structure
interface ChatMessage {
  role: string;
  message: string;
}

async function getThreadHistory(threadId: string, messageLimit: number = 10) {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Retrieve messages from the thread
    const messages = await openai.beta.threads.messages.list(threadId);

    // Format messages into our ChatMessage structure
    const formattedMessages: ChatMessage[] = messages.data
      .slice(0, messageLimit) // Limit the number of messages
      .map(msg => ({
        role: msg.role,
        // @ts-ignore
        message: msg.content[0]?.text?.value || ''
      }))
      .filter(msg => msg.message) // Remove any messages without content
      .reverse(); // Most recent messages first

    // Create a formatted history string
    const formattedHistory = formattedMessages.map(msg => {
      const roleLabel = msg.role === 'user' ? 'Usuario' : 'Asistente';
      return `${roleLabel}: ${msg.message}`;
    });

    return {
      messages: formattedMessages,
      formattedHistory,
      threadId
    };

  } catch (error) {
    console.error("Error retrieving thread history:", error);
    throw new Error("No se pudo recuperar el historial del thread");
  }
}

// Helper function for message formatting
function formatMessageHistory(messages: ChatMessage[]) {
  return messages.map(msg => {
    const roleLabel = msg.role === 'user' ? 'Cliente' : 'Agente';
    return `${roleLabel}: ${msg.message}`;
  }).join('\n');
}

// Function to get last N messages from a thread
async function getLastMessages(threadId: string, currentMessage: string, count: number = 20) {
  try {
    const { messages } = await getThreadHistory(threadId, count);
    const history = formatMessageHistory(messages);
    return `${history}\n Cliente: ${currentMessage}`
  } catch (error) {
    console.error("Error getting last messages:", error);
    throw new Error("No se pudieron obtener los últimos mensajes");
  }
}

export default { getLastMessages } as const;