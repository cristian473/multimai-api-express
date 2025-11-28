import { db, admin } from "../firebase";

const FieldValue = admin.firestore.FieldValue;
import {
  conversationsCollection,
  messagesCollection as legacyMessagesCollection,
  multimaiMessagesCollection,
  customersCollection,
} from "../constants";
import { ConversationMessage } from "../types";
import { generateObject } from "ai";
import { getModel } from "../../ai/openrouter";
import { AI_CONFIG } from "../../ai/config";
import { z } from "zod";
import { scheduleConversationClose } from "../../queues/conversation-queue";
import logger from "jet-logger";

// Legacy function - kept for backward compatibility with old conversations
function getTodayDateKey(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}${month}${year}`;
}

// Helper to get messages collection path
function getMessagesCollection(uid: string, phone: string, conversationId: string): string {
  return `users/${uid}/customers/${phone}/conversations/${conversationId}/messages`;
}

/**
 * Get or create an active conversation for a customer
 * Uses new schema with isOpen flag and auto-generated Firestore ID
 */
async function getOrCreateActiveConversation(
  uid: string,
  phone: string,
  customerName?: string
): Promise<{ conversationId: string; isNew: boolean }> {
  try {
    // Check if customer has an active conversation
    const customerRef = db.doc(`users/${uid}/customers/${phone}`);
    const customerSnapshot = await customerRef.get();

    if (customerSnapshot.exists) {
      const customerData = customerSnapshot.data();
      const activeConversationId = customerData?.activeConversationId;

      if (activeConversationId) {
        // Verify the conversation exists and is open
        const conversationRef = db.doc(
          `users/${uid}/customers/${phone}/conversations/${activeConversationId}`
        );
        const conversationSnapshot = await conversationRef.get();

        if (conversationSnapshot.exists && conversationSnapshot.data()?.isOpen === true) {
          return { conversationId: activeConversationId, isNew: false };
        }
      }
    }

    // Create new conversation with auto-generated Firestore ID
    const conversationsRef = db.collection(`users/${uid}/customers/${phone}/conversations`);
    const newConversationRef = conversationsRef.doc(); // Auto-generate ID
    const conversationId = newConversationRef.id;

    await newConversationRef.set({
      isOpen: true,
      createdAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      messageCount: 0,
    });

    // Update customer with active conversation ID
    if (customerSnapshot.exists) {
      await customerRef.update({
        activeConversationId: conversationId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      // Create customer document if it doesn't exist
      await customerRef.set({
        name: customerName || phone,
        phone: phone,
        activeConversationId: conversationId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info(`[Conversations] Created new conversation ${conversationId} for ${phone}`);
    return { conversationId, isNew: true };
  } catch (error) {
    logger.err("[Conversations] Error getting/creating active conversation:", error);
    throw error;
  }
}

/**
 * Save a message to the active conversation (new schema)
 * Automatically schedules conversation close job after 60 minutes
 * Uses messageId as document ID when provided to avoid duplicates
 * 
 * @param executionId - Optional execution ID for tracking messages that can be rolled back on abort
 */
export async function saveConversationMessage(
  uid: string,
  phone: string,
  role: "user" | "assistant" | "system",
  content: string,
  messageId?: string,
  isContext?: boolean,
  customerName?: string,
  executionId?: string
): Promise<void> {

  console.log('saveConversationMessage', { uid, phone, role, content, messageId, isContext, customerName, executionId });
  // Get or create active conversation
  const { conversationId, isNew } = await getOrCreateActiveConversation(uid, phone, customerName);

  logger.info(`[Conversations] Saving ${role} message to conversation ${conversationId} (isContext: ${isContext || false}, executionId: ${executionId || 'none'})`);

  // Save message
  const messageData: any = {
    role,
    content,
    timestamp: FieldValue.serverTimestamp(),
  };

  if (messageId) {
    messageData.chatMessageId = messageId;
  }

  if (isContext) {
    messageData.isContext = true;
  }

  // Add executionId for tracking and potential rollback
  if (executionId) {
    messageData.executionId = executionId;
  }

  const messagesCollection = db.collection(getMessagesCollection(uid, phone, conversationId));
  console.log('messagesCollection', messagesCollection);

  // Use messageId as document ID when available to prevent duplicates
  if (messageId) {
    console.log('messageId', messageId);
    // Use set with merge to avoid overwriting if message already exists
    await messagesCollection.doc(messageId).set(messageData, { merge: true });
    logger.info(`[Conversations] Saved ${role} message with ID ${messageId}`);
  } else {
    console.log('messageId not found');
    // Generate random ID for messages without ID (assistant messages, context, etc.)
    const docRef = await messagesCollection.add(messageData);
    logger.info(`[Conversations] Saved ${role} message with auto-generated ID ${docRef.id}`);
  }

  // Update conversation metadata
  const conversationRef = db.doc(
    `users/${uid}/customers/${phone}/conversations/${conversationId}`
  );
  await conversationRef.update({
    messageCount: FieldValue.increment(1),
    lastMessageAt: FieldValue.serverTimestamp(),
  });

  // Schedule/reschedule conversation close job (60 min sliding window)
  // This is fire-and-forget - don't fail the message save if queue fails
  try {
    const name = customerName || (await getCustomerName(uid, phone)) || phone;
    await scheduleConversationClose(uid, phone, conversationId, name);
  } catch (queueError) {
    logger.err(`[Conversations] Error scheduling conversation close (non-fatal): ${queueError}`);
    // Don't throw - queue failure shouldn't prevent message from being saved
  }
}

/**
 * Get customer name from database
 */
async function getCustomerName(uid: string, phone: string): Promise<string | null> {
  try {
    const customerRef = db.doc(`users/${uid}/customers/${phone}`);
    const customerSnapshot = await customerRef.get();
    return customerSnapshot.data()?.name || null;
  } catch {
    return null;
  }
}

/**
 * Get messages from the active conversation (new schema)
 */
export async function getActiveConversationMessages(
  uid: string,
  phone: string,
  includeContext: boolean = false
): Promise<ConversationMessage[]> {
  try {
    // Get active conversation ID
    const customerRef = db.doc(`users/${uid}/customers/${phone}`);
    const customerSnapshot = await customerRef.get();
    const activeConversationId = customerSnapshot.data()?.activeConversationId;

    if (!activeConversationId) {
      // Fallback to legacy date-based lookup
      return getTodayConversationMessagesLegacy(uid, phone, includeContext);
    }

    const messagesSnapshot = await db
      .collection(getMessagesCollection(uid, phone, activeConversationId))
      .orderBy("timestamp", "asc")
      .get();

    if (messagesSnapshot.empty) {
      return [];
    }

    const messages = messagesSnapshot.docs.map((doc) => ({
      role: doc.data().role,
      content: doc.data().content,
      timestamp: doc.data().timestamp,
      whatsappMessageId: doc.data().chatMessageId,
      isContext: doc.data().isContext || false,
    }));

    if (!includeContext) {
      return messages.filter((msg) => !msg.isContext);
    }

    return messages;
  } catch (error) {
    logger.err("[Conversations] Error getting active conversation messages:", error);
    return [];
  }
}

/**
 * Legacy function for backward compatibility - get today's messages by date key
 */
export async function getTodayConversationMessagesLegacy(
  uid: string,
  phone: string,
  includeContext: boolean = false
): Promise<ConversationMessage[]> {
  try {
    const dateKey = getTodayDateKey();

    const messagesSnapshot = await db
      .collection(legacyMessagesCollection(uid, phone, dateKey))
      .orderBy("timestamp", "asc")
      .get();

    if (messagesSnapshot.empty) {
      return [];
    }

    const messages = messagesSnapshot.docs.map((doc) => ({
      role: doc.data().role,
      content: doc.data().content,
      timestamp: doc.data().timestamp,
      whatsappMessageId: doc.data().whatsapp_message_id || doc.data().chatMessageId,
      isContext: doc.data().isContext || false,
    }));

    if (!includeContext) {
      return messages.filter((msg) => !msg.isContext);
    }

    return messages;
  } catch (error) {
    logger.err("[Conversations] Error getting today conversation messages:", error);
    return [];
  }
}

/**
 * Get today's conversation messages - wrapper that tries new schema first, then legacy
 */
export async function getTodayConversationMessages(
  uid: string,
  phone: string,
  includeContext: boolean = false
): Promise<ConversationMessage[]> {
  // Try new schema first
  const activeMessages = await getActiveConversationMessages(uid, phone, includeContext);
  if (activeMessages.length > 0) {
    return activeMessages;
  }

  // Fallback to legacy
  return getTodayConversationMessagesLegacy(uid, phone, includeContext);
}

/**
 * Get context messages from active conversation
 */
export async function getTodayContextMessages(
  uid: string,
  phone: string
): Promise<ConversationMessage[]> {
  try {
    // Get active conversation ID
    const customerRef = db.doc(`users/${uid}/customers/${phone}`);
    const customerSnapshot = await customerRef.get();
    const activeConversationId = customerSnapshot.data()?.activeConversationId;

    if (!activeConversationId) {
      // Fallback to legacy
      const dateKey = getTodayDateKey();
      const messagesSnapshot = await db
        .collection(legacyMessagesCollection(uid, phone, dateKey))
        .where("isContext", "==", true)
        .orderBy("timestamp", "asc")
        .get();

      if (messagesSnapshot.empty) {
        return [];
      }

      return messagesSnapshot.docs.map((doc) => ({
        role: doc.data().role,
        content: doc.data().content,
        timestamp: doc.data().timestamp,
        isContext: true,
      }));
    }

    const messagesSnapshot = await db
      .collection(getMessagesCollection(uid, phone, activeConversationId))
      .where("isContext", "==", true)
      .orderBy("timestamp", "asc")
      .get();

    if (messagesSnapshot.empty) {
      return [];
    }

    return messagesSnapshot.docs.map((doc) => ({
      role: doc.data().role,
      content: doc.data().content,
      timestamp: doc.data().timestamp,
      isContext: true,
    }));
  } catch (error) {
    logger.err("[Conversations] Error getting context messages:", error);
    return [];
  }
}

/**
 * Get recent user messages with their WhatsApp IDs
 */
export async function getRecentUserMessages(
  uid: string,
  phone: string,
  limit: number = 10
): Promise<Array<{ content: string; chatMessageId?: string; timestamp: any }>> {
  try {
    // Get active conversation ID
    const customerRef = db.doc(`users/${uid}/customers/${phone}`);
    const customerSnapshot = await customerRef.get();
    const activeConversationId = customerSnapshot.data()?.activeConversationId;

    let messagesSnapshot;

    if (activeConversationId) {
      messagesSnapshot = await db
        .collection(getMessagesCollection(uid, phone, activeConversationId))
        .where("role", "==", "user")
        .orderBy("timestamp", "desc")
        .limit(limit)
        .get();
    } else {
      // Fallback to legacy
      const dateKey = getTodayDateKey();
      messagesSnapshot = await db
        .collection(legacyMessagesCollection(uid, phone, dateKey))
        .where("role", "==", "user")
        .orderBy("timestamp", "desc")
        .limit(limit)
        .get();
    }

    if (messagesSnapshot.empty) {
      return [];
    }

    return messagesSnapshot.docs.reverse().map((doc) => ({
      content: doc.data().content,
      chatMessageId: doc.data().chatMessageId || doc.data().chat_message_id,
      timestamp: doc.data().timestamp,
    }));
  } catch (error) {
    logger.err("[Conversations] Error getting recent user messages:", error);
    return [];
  }
}

/**
 * Get summaries from previous closed conversations
 */
export async function getPreviousConversationSummaries(
  uid: string,
  phone: string,
  limit: number = 5
): Promise<any[]> {
  try {
    // Get active conversation ID to exclude it
    const customerRef = db.doc(`users/${uid}/customers/${phone}`);
    const customerSnapshot = await customerRef.get();
    const activeConversationId = customerSnapshot.data()?.activeConversationId;

    // Get closed conversations ordered by creation date
    const conversationsSnapshot = await db
      .collection(`users/${uid}/customers/${phone}/conversations`)
      .where("isOpen", "==", false)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    if (conversationsSnapshot.empty) {
      // Fallback to legacy query
      const todayDateKey = getTodayDateKey();
      const legacySnapshot = await db
        .collection(`users/${uid}/customers/${phone}/conversations`)
        .orderBy("date", "desc")
        .limit(limit + 1)
        .get();

      return legacySnapshot.docs
        .filter((doc) => doc.id !== todayDateKey)
        .slice(0, limit)
        .map((doc) => ({
          id: doc.id,
          date: doc.data().date || doc.id,
          summary: doc.data().summary || "",
          messageCount: doc.data().message_count || doc.data().messageCount || 0,
        }));
    }

    return conversationsSnapshot.docs.map((doc) => ({
      id: doc.id,
      summary: doc.data().summary || "",
      messageCount: doc.data().messageCount || 0,
      createdAt: doc.data().createdAt,
      closedAt: doc.data().closedAt,
    }));
  } catch (error) {
    logger.err("[Conversations] Error getting previous conversation summaries:", error);
    console.error('error', error);
    return [];
  }
}

/**
 * Get all messages from all conversations for a customer
 * Used for full BANT analysis
 */
export async function getAllCustomerMessages(
  uid: string,
  phone: string,
  includeContext: boolean = true
): Promise<Array<{ role: string; content: string; timestamp: any; isContext?: boolean }>> {
  const allMessages: Array<{ role: string; content: string; timestamp: any; isContext?: boolean }> = [];

  try {
    const conversationsSnapshot = await db
      .collection(`users/${uid}/customers/${phone}/conversations`)
      .get();

    for (const convDoc of conversationsSnapshot.docs) {
      const messagesSnapshot = await db
        .collection(`users/${uid}/customers/${phone}/conversations/${convDoc.id}/messages`)
        .orderBy("timestamp", "asc")
        .get();

      for (const msgDoc of messagesSnapshot.docs) {
        const data = msgDoc.data();
        const isContextMsg = data.isContext || false;

        if (!includeContext && isContextMsg) {
          continue;
        }

        allMessages.push({
          role: data.role,
          content: data.content,
          timestamp: data.timestamp?.toDate?.() || data.timestamp,
          isContext: isContextMsg,
        });
      }
    }

    // Sort all messages by timestamp
    allMessages.sort((a, b) => {
      const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
      const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
      return timeA - timeB;
    });

    return allMessages;
  } catch (error) {
    logger.err("[Conversations] Error getting all customer messages:", error);
    return [];
  }
}

// Multimai conversation functions
export async function getMultimaiMessages(
  phone: string,
  limit: number = 50
): Promise<ConversationMessage[]> {
  try {
    const messagesSnapshot = await db
      .collection(multimaiMessagesCollection(phone))
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    if (messagesSnapshot.empty) {
      return [];
    }

    return messagesSnapshot.docs.reverse().map((doc) => ({
      role: doc.data().role,
      content: doc.data().content,
      timestamp: doc.data().timestamp,
      chatMessageId: doc.data().chatMessageId || doc.data().chat_message_id,
    }));
  } catch (error) {
    logger.err("[Conversations] Error getting multimai messages:", error);
    return [];
  }
}

export async function saveMultimaiMessage(
  phone: string,
  role: "user" | "assistant",
  content: string
): Promise<boolean> {
  try {
    await db.collection(multimaiMessagesCollection(phone)).add({
      role,
      content,
      timestamp: FieldValue.serverTimestamp(),
    });

    const conversationRef = db.doc(`agents/multimai/conversations/${phone}`);
    const conversationSnapshot = await conversationRef.get();

    if (!conversationSnapshot.exists) {
      await conversationRef.set({
        createdAt: FieldValue.serverTimestamp(),
        messageCount: 1,
        lastMessageAt: FieldValue.serverTimestamp(),
      });
    } else {
      await conversationRef.update({
        messageCount: FieldValue.increment(1),
        lastMessageAt: FieldValue.serverTimestamp(),
      });
    }

    return true;
  } catch (error) {
    logger.err("[Conversations] Error saving multimai message:", error);
    return false;
  }
}

export interface ContextSummaryResult {
  shouldApply: boolean;
  relevanceScore: number;
  reason: string;
  summary: string | null;
  toolsExecuted: string[];
}

/**
 * Generate intelligent summary of context messages using LLM
 */
export async function generateContextSummary(
  uid: string,
  phone: string,
  userQuestion: string,
  conversationHistory: ConversationMessage[],
  threshold: number = 0.6
): Promise<ContextSummaryResult> {
  try {
    const contextMessages = await getTodayContextMessages(uid, phone);

    if (contextMessages.length === 0) {
      logger.info("[generateContextSummary] No context messages found");
      return {
        shouldApply: false,
        relevanceScore: 0,
        reason: "No hay mensajes de contexto disponibles",
        summary: null,
        toolsExecuted: [],
      };
    }

    logger.info(`[generateContextSummary] Analyzing ${contextMessages.length} context messages`);

    const recentHistory = conversationHistory
      .slice(-10)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const contextText = contextMessages.map((msg) => msg.content).join("\n");

    const toolsExecuted = Array.from(
      new Set(
        contextMessages
          .map((msg) => {
            const match = msg.content.match(/tool executed: (\w+)/);
            return match ? match[1] : null;
          })
          .filter(Boolean)
      )
    ) as string[];

    const prompt = `<task>
Eres un asistente que analiza logs de ejecución de herramientas y evalúa su relevancia para la conversación actual.

<contexto>
<pregunta_usuario>
${userQuestion}
</pregunta_usuario>

<historial_reciente>
${recentHistory}
</historial_reciente>

<mensajes_contexto>
${contextText}
</mensajes_contexto>
</contexto>

<instrucciones>
1. Analiza los mensajes de contexto (logs de herramientas ejecutadas)
2. Asigna un score de relevancia (0.0 a 1.0) que indique qué tan útil es este contexto para responder la pregunta actual
3. Asigna score ALTO (0.7-1.0) si:
   - Las búsquedas previas están directamente relacionadas con la pregunta actual
   - Las propiedades encontradas son relevantes para el contexto actual
   - Las visitas programadas/canceladas son pertinentes a la conversación
   - Los resultados previos pueden ayudar a mejorar la respuesta

4. Asigna score BAJO (0.0-0.3) si:
   - Los logs son de conversaciones anteriores no relacionadas
   - Las búsquedas previas son sobre temas diferentes
   - El contexto es demasiado antiguo o irrelevante
   - La pregunta actual es completamente nueva y sin relación

5. Asigna score MEDIO (0.4-0.6) para casos intermedios

6. Si el score es >= ${threshold}, genera un resumen conciso (máximo 3-4 puntos) que incluya:
   - Búsquedas realizadas y sus resultados (con número de propiedades encontradas)
   - Propiedades encontradas o consultadas (INCLUIR property_id si está disponible)
   - Visitas programadas o canceladas (INCLUIR visit_id, fecha y hora si están disponibles)
   - IDs de búsquedas (searchId) para poder referenciarlas
   - Cualquier metadata útil: fechas, horarios, cantidades, IDs de propiedades/visitas
   - NO incluyas IDs internos de base de datos (como documentId de Firestore)
   - SÍ incluye IDs funcionales que el agente puede usar (property_id, visit_id, searchId)
   - Usa lenguaje natural pero preserva IDs y datos técnicos útiles

</instrucciones>

<formato_salida>
Responde ÚNICAMENTE en formato JSON (sin markdown ni bloques de código):
{
  "relevance_score": [número entre 0.0 y 1.0 indicando relevancia del contexto],
  "reason": "[explicación breve de por qué este score de relevancia]",
  "summary": "[resumen conciso si score >= ${threshold}, o null si score < ${threshold}]"
}
</formato_salida>
</task>`;

    const contextSummarySchema = z.object({
      relevance_score: z
        .number()
        .min(0)
        .max(1)
        .describe("Número entre 0.0 y 1.0 indicando relevancia del contexto"),
      reason: z.string().describe("Explicación breve de por qué este score de relevancia"),
      summary: z
        .string()
        .nullable()
        .describe("Resumen conciso si score >= threshold, o null si score < threshold"),
    });

    const model = getModel(AI_CONFIG?.CONTEXT_SUMMARY_MODEL ?? "openai/gpt-4o-mini");
    const { object: result } = await generateObject({
      model: model as any,
      schema: contextSummarySchema,
      prompt: prompt,
      temperature: 0.3,
    });

    const contextSummaryResult: ContextSummaryResult = {
      shouldApply: result.relevance_score >= threshold,
      relevanceScore: result.relevance_score || 0,
      reason: result.reason || "No reason provided",
      summary: result.relevance_score >= threshold ? result.summary : null,
      toolsExecuted: toolsExecuted,
    };

    logger.info(
      `[generateContextSummary] Relevance score: ${contextSummaryResult.relevanceScore.toFixed(2)} (threshold: ${threshold})`
    );
    logger.info(`[generateContextSummary] Reason: ${contextSummaryResult.reason}`);
    logger.info(`[generateContextSummary] Should apply: ${contextSummaryResult.shouldApply}`);

    return contextSummaryResult;
  } catch (error) {
    logger.err("[generateContextSummary] Error generating context summary:", error);
    return {
      shouldApply: false,
      relevanceScore: 0,
      reason: "Error processing context",
      summary: null,
      toolsExecuted: [],
    };
  }
}

/**
 * Delete all messages with a specific executionId
 * Used for cleanup when a message processing is aborted
 * 
 * @param uid - User ID
 * @param phone - Customer phone number
 * @param executionId - The execution ID to match
 * @returns Number of messages deleted
 */
export async function deleteMessagesByExecutionId(
  uid: string,
  phone: string,
  executionId: string
): Promise<number> {
  let deletedCount = 0;

  try {
    logger.info(`[Conversations] Deleting messages with executionId: ${executionId} for ${phone}`);

    // Get all conversations for this customer
    const conversationsSnapshot = await db
      .collection(`users/${uid}/customers/${phone}/conversations`)
      .get();

    if (conversationsSnapshot.empty) {
      logger.info(`[Conversations] No conversations found for ${phone}`);
      return 0;
    }

    // Use batch for efficient deletion
    const batch = db.batch();
    let batchCount = 0;
    const MAX_BATCH_SIZE = 500; // Firestore limit

    for (const convDoc of conversationsSnapshot.docs) {
      // Query messages with matching executionId
      const messagesSnapshot = await db
        .collection(`users/${uid}/customers/${phone}/conversations/${convDoc.id}/messages`)
        .where("executionId", "==", executionId)
        .get();

      for (const msgDoc of messagesSnapshot.docs) {
        batch.delete(msgDoc.ref);
        batchCount++;
        deletedCount++;

        // Commit batch if approaching limit
        if (batchCount >= MAX_BATCH_SIZE) {
          await batch.commit();
          batchCount = 0;
        }
      }
    }

    // Commit remaining items
    if (batchCount > 0) {
      await batch.commit();
    }

    logger.info(`[Conversations] Deleted ${deletedCount} messages with executionId: ${executionId}`);
    return deletedCount;
  } catch (error) {
    logger.err(`[Conversations] Error deleting messages by executionId ${executionId}:`, error);
    return deletedCount;
  }
}

/**
 * Create a cleanup function for ExecutionContext
 * Returns a function that deletes messages with the given executionId
 */
export function createMessageCleanupFn(uid: string, phone: string): (executionId: string) => Promise<void> {
  return async (executionId: string) => {
    await deleteMessagesByExecutionId(uid, phone, executionId);
  };
}
