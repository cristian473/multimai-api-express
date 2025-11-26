import { db, admin } from "../firebase";

const FieldValue = admin.firestore.FieldValue;
import {
  conversationDoc,
  messagesCollection,
  multimaiMessagesCollection,
} from "../constants";
import { ConversationMessage } from "../types";
import { generateObject } from "ai";
import { getModel } from "../../ai/openrouter";
import { AI_CONFIG } from "../../ai/config";
import { z } from "zod";

function getTodayDateKey(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}${month}${year}`;
}

export async function saveConversationMessage(
  uid: string,
  phone: string,
  role: "user" | "assistant",
  content: string,
  messageId?: string, // ID del mensaje de WhatsApp (opcional)
  isContext?: boolean, // Flag para marcar mensajes de contexto (ejecuciones de tools, logs internos)
): Promise<void> {
  try {
    const dateKey = getTodayDateKey();

    // Create or update conversation document
    const conversationRef = db.doc(conversationDoc(uid, phone, dateKey));
    const conversationSnapshot = await conversationRef.get();

    if (!conversationSnapshot.exists) {
      await conversationRef.set({
        date: dateKey,
        created_at: FieldValue.serverTimestamp(),
        summary: "",
        message_count: 0,
      });
    }

    // Save individual message with optional messageId and isContext flag
    const messageData: any = {
      role,
      content,
      timestamp: FieldValue.serverTimestamp(),
    };

    // Si hay messageId, agregarlo para poder referenciar el mensaje después
    if (messageId) {
      messageData.chat_message_id = messageId;
    }

    // Si es un mensaje de contexto, marcarlo
    if (isContext) {
      messageData.isContext = true;
    }

    await db.collection(messagesCollection(uid, phone, dateKey)).add(messageData);

    // Increment message count
    await conversationRef.update({
      message_count: FieldValue.increment(1),
      last_message_at: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Error saving conversation message:", error);
  }
}

export async function getTodayConversationMessages(
  uid: string,
  phone: string,
  includeContext: boolean = false, // Flag para incluir o excluir mensajes de contexto
): Promise<ConversationMessage[]> {
  try {
    const dateKey = getTodayDateKey();

    const messagesSnapshot = await db
      .collection(messagesCollection(uid, phone, dateKey))
      .orderBy("timestamp", "asc")
      .get();

    if (messagesSnapshot.empty) {
      return [];
    }

    const messages = messagesSnapshot.docs.map((doc) => ({
      role: doc.data().role,
      content: doc.data().content,
      timestamp: doc.data().timestamp,
      whatsapp_message_id: doc.data().whatsapp_message_id,
      isContext: doc.data().isContext || false,
    }));

    // Filtrar mensajes de contexto si includeContext es false
    if (!includeContext) {
      return messages.filter((msg) => !msg.isContext);
    }

    return messages;
  } catch (error) {
    console.error("Error getting today conversation messages:", error);
    return [];
  }
}

/**
 * Obtiene solo los mensajes de contexto del día actual
 * Útil para generar resúmenes de contexto con LLM
 */
export async function getTodayContextMessages(
  uid: string,
  phone: string,
): Promise<ConversationMessage[]> {
  try {
    const dateKey = getTodayDateKey();

    const messagesSnapshot = await db
      .collection(messagesCollection(uid, phone, dateKey))
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
    console.error("Error getting today context messages:", error);
    return [];
  }
}

/**
 * Obtiene los últimos N mensajes del usuario con sus IDs de WhatsApp
 * Útil para tener contexto cuando se solicita ayuda al dueño
 */
export async function getRecentUserMessages(
  uid: string,
  phone: string,
  limit: number = 10,
): Promise<Array<{ content: string; chat_message_id?: string; timestamp: any }>> {
  try {
    const dateKey = getTodayDateKey();

    const messagesSnapshot = await db
      .collection(messagesCollection(uid, phone, dateKey))
      .where("role", "==", "user")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    if (messagesSnapshot.empty) {
      return [];
    }

    // Revertir el orden para que los mensajes más recientes estén al final
    return messagesSnapshot.docs.reverse().map((doc) => ({
      content: doc.data().content,
      chat_message_id: doc.data().chat_message_id,
      timestamp: doc.data().timestamp,
    }));
  } catch (error) {
    console.error("Error getting recent user messages:", error);
    return [];
  }
}

export async function getPreviousConversationSummaries(
  uid: string,
  phone: string,
  limit: number = 5,
): Promise<any[]> {
  try {
    const todayDateKey = getTodayDateKey();

    const conversationsSnapshot = await db
      .collection(`users/${uid}/customers/${phone}/conversations`)
      .where("date", "<", todayDateKey)
      .orderBy("date", "desc")
      .limit(limit)
      .get();

    if (conversationsSnapshot.empty) {
      return [];
    }

    return conversationsSnapshot.docs.map((doc) => ({
      date: doc.data().date,
      summary: doc.data().summary || "",
      message_count: doc.data().message_count || 0,
    }));
  } catch (error) {
    console.error("Error getting previous conversation summaries:", error);
    return [];
  }
}

// Multimai conversation functions
export async function getMultimaiMessages(
  phone: string,
  limit: number = 50,
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
      chat_message_id: doc.data().chat_message_id,
    }));
  } catch (error) {
    console.error("Error getting multimai messages:", error);
    return [];
  }
}

export async function saveMultimaiMessage(
  phone: string,
  role: "user" | "assistant",
  content: string,
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
        created_at: FieldValue.serverTimestamp(),
        message_count: 1,
        last_message_at: FieldValue.serverTimestamp(),
      });
    } else {
      await conversationRef.update({
        message_count: FieldValue.increment(1),
        last_message_at: FieldValue.serverTimestamp(),
      });
    }

    return true;
  } catch (error) {
    console.error("Error saving multimai message:", error);
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
 * Genera un resumen inteligente de los mensajes de contexto usando LLM
 * Retorna objeto estructurado con score, reason y resumen
 */
export async function generateContextSummary(
  uid: string,
  phone: string,
  userQuestion: string,
  conversationHistory: ConversationMessage[],
  threshold: number = 0.6
): Promise<ContextSummaryResult> {
  try {
    // Obtener mensajes de contexto del día
    const contextMessages = await getTodayContextMessages(uid, phone);

    if (contextMessages.length === 0) {
      console.log("[generateContextSummary] No context messages found");
      return {
        shouldApply: false,
        relevanceScore: 0,
        reason: "No hay mensajes de contexto disponibles",
        summary: null,
        toolsExecuted: []
      };
    }

    console.log(`[generateContextSummary] Analyzing ${contextMessages.length} context messages`);

    // Preparar el historial de conversación (últimos 10 mensajes)
    const recentHistory = conversationHistory
      .slice(-10)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    // Preparar mensajes de contexto
    const contextText = contextMessages
      .map((msg) => msg.content)
      .join("\n");

    // Extraer nombres de herramientas ejecutadas
    const toolsExecuted = Array.from(new Set(
      contextMessages
        .map(msg => {
          const match = msg.content.match(/tool executed: (\w+)/);
          return match ? match[1] : null;
        })
        .filter(Boolean)
    )) as string[];

    // Prompt para el LLM
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

Ejemplos:
- Pregunta nueva sin relación con logs previos:
  {"relevance_score": 0.2, "reason": "los logs son de búsquedas anteriores sin relación con la pregunta actual", "summary": null}

- Pregunta relacionada con búsqueda previa:
  {"relevance_score": 0.9, "reason": "búsqueda previa de departamentos en Palermo es directamente relevante", "summary": "Búsqueda anterior (searchId: abc123): se encontraron 5 departamentos en Palermo. Propiedades consultadas: property_id 001 (2 amb, $120k), property_id 002 (3 amb, $180k). No se programaron visitas aún."}

- Pregunta sobre visita ya agendada:
  {"relevance_score": 0.95, "reason": "existe una visita programada para la propiedad mencionada", "summary": "Visita programada (visit_id: xyz789) para property_id 001 (departamento 2 amb en Palermo) el viernes 15/11 a las 14:00. Cliente ya confirmó asistencia."}

- Pregunta sobre disponibilidad consultada previamente:
  {"relevance_score": 0.85, "reason": "se consultó disponibilidad de visitas hace minutos", "summary": "Disponibilidad consultada para property_id 003. Visitas disponibles: sábado 16/11 a las 10:00, 15:00 y 17:00. Cliente aún no agendó."}

- Búsqueda sin resultados previa:
  {"relevance_score": 0.7, "reason": "búsqueda previa no encontró resultados pero es relevante", "summary": "Búsqueda anterior de casas en Villa Crespo con 3 dormitorios y presupuesto $250k no encontró resultados. Podría necesitar ampliar criterios."}
</formato_salida>
</task>`;

    // Define Zod schema for structured output
    const contextSummarySchema = z.object({
      relevance_score: z.number().min(0).max(1).describe('Número entre 0.0 y 1.0 indicando relevancia del contexto'),
      reason: z.string().describe('Explicación breve de por qué este score de relevancia'),
      summary: z.string().nullable().describe('Resumen conciso si score >= threshold, o null si score < threshold')
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
      reason: result.reason || 'No reason provided',
      summary: result.relevance_score >= threshold ? result.summary : null,
      toolsExecuted: toolsExecuted
    };

    console.log(`[generateContextSummary] Relevance score: ${contextSummaryResult.relevanceScore.toFixed(2)} (threshold: ${threshold})`);
    console.log(`[generateContextSummary] Reason: ${contextSummaryResult.reason}`);
    console.log(`[generateContextSummary] Should apply: ${contextSummaryResult.shouldApply}`);
    console.log(`[generateContextSummary] Tools executed: ${toolsExecuted.join(', ')}`);

    if (contextSummaryResult.shouldApply && contextSummaryResult.summary) {
      console.log(`[generateContextSummary] Summary: ${contextSummaryResult.summary}`);
    }

    return contextSummaryResult;
  } catch (error) {
    console.error("[generateContextSummary] Error generating context summary:", error);
    return {
      shouldApply: false,
      relevanceScore: 0,
      reason: 'Error processing context',
      summary: null,
      toolsExecuted: []
    };
  }
}
