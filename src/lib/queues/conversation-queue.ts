/**
 * Conversation Queue - BullMQ implementation for conversation closing
 * Uses sliding window approach: closes conversations after 60min of inactivity
 */

import { Queue, Worker, Job } from 'bullmq';
import { getQueueConnection } from './redis-connection';
import { db, admin } from '../db/firebase';
import { generateObject } from 'ai';
import { getModel } from '../ai/openrouter';
import { AI_CONFIG } from '../ai/config';
import { z } from 'zod';
import logger from 'jet-logger';

const FieldValue = admin.firestore.FieldValue;

// Queue configuration
export const CONVERSATION_QUEUE_NAME = 'conversation-close';
export const CONVERSATION_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
export const MIN_MESSAGES_FOR_SUMMARY = 10;

// Job data interface
interface ConversationCloseJobData {
  uid: string;
  phone: string;
  conversationId: string;
  customerName: string;
  scheduledAt: number;
}

// Simplified conversation summary schema - list of propositions
const conversationSummarySchema = z.object({
  propositions: z.array(z.string()).describe(
    'Lista ordenada de proposiciones que describen lo ocurrido en la conversación. ' +
    'Cada proposición debe ser una oración completa que incluya IDs, acciones, datos y resultados relevantes. ' +
    'Ordenadas cronológicamente según la ejecución.'
  ),
});

type ConversationSummaryResult = z.infer<typeof conversationSummarySchema>;

// Lead analysis schema - enriched with preferences, properties viewed, and categorized tags
const leadAnalysisSchema = z.object({
  // BANT scores
  intentionScore: z.number().min(0).max(10).describe('Score de intención de compra/alquiler (0-10)'),
  economicCapacity: z.enum(['alta', 'media', 'baja', 'desconocida']).describe('Capacidad económica del lead'),
  urgencyScore: z.number().min(0).max(10).describe('Score de urgencia/timeline (0-10)'),
  engagementScore: z.number().min(0).max(10).describe('Score de engagement/interacción (0-10)'),
  positiveSignals: z.array(z.string()).describe('Lista de señales positivas detectadas'),
  negativeSignals: z.array(z.string()).describe('Lista de señales negativas detectadas'),
  leadStage: z.enum(['caliente', 'tibio', 'frío', 'muy_frío']).describe('Etapa del lead'),
  bantScores: z.object({
    budget: z.number().min(0).max(25).describe('Score de presupuesto (0-25)'),
    authority: z.number().min(0).max(15).describe('Score de autoridad para decidir (0-15)'),
    need: z.number().min(0).max(20).describe('Score de necesidad definida (0-20)'),
    timeline: z.number().min(0).max(25).describe('Score de urgencia/timeline (0-25)'),
    engagement: z.number().min(0).max(15).describe('Score de engagement (0-15)'),
  }).describe('Scores detallados BANT'),
  totalScore: z.number().min(0).max(100).describe('Score total (0-100)'),
  summary: z.string().describe('Resumen breve de la conversación'),

  // Preferences
  preferences: z.object({
    operationType: z.array(z.string()).describe('Tipos de operación: compra, alquiler, inversión'),
    propertyTypes: z.array(z.string()).describe('Tipos de propiedad: departamento, casa, ph, local, oficina, terreno'),
    locations: z.array(z.string()).describe('Ubicaciones de interés mencionadas'),
    priceRange: z.object({
      min: z.number().nullable().describe('Precio mínimo mencionado o null si no se especificó'),
      max: z.number().nullable().describe('Precio máximo mencionado o null si no se especificó'),
      currency: z.string().describe('Moneda: USD, ARS, etc.')
    }).nullable().describe('Rango de precios mencionado o null si no se especificó'),
    features: z.array(z.string()).describe('Características deseadas: cochera, balcón, amenities, etc.'),
    bedrooms: z.number().nullable().describe('Número de dormitorios deseados o null si no se especificó'),
    bathrooms: z.number().nullable().describe('Número de baños deseados o null si no se especificó'),
  }).describe('Preferencias del lead'),

  // Properties viewed
  propertiesViewed: z.array(z.object({
    propertyId: z.string().describe('ID de la propiedad consultada'),
    name: z.string().describe('Nombre o título de la propiedad'),
    description: z.string().describe('Descripción breve de la propiedad'),
    askedAbout: z.array(z.string()).describe('Qué preguntó: precio, disponibilidad, visita, etc.')
  })).describe('Propiedades consultadas durante la conversación'),

  // Categorized tags
  tags: z.object({
    operation: z.array(z.string()).describe('Tags de operación'),
    propertyType: z.array(z.string()).describe('Tags de tipo de propiedad'),
    location: z.array(z.string()).describe('Tags de ubicación'),
    budget: z.array(z.string()).describe('Tags de presupuesto'),
    timeline: z.array(z.string()).describe('Tags de urgencia/timeline'),
    custom: z.array(z.string()).describe('Tags adicionales')
  }).describe('Tags categorizados'),

  // Interests
  interests: z.array(z.object({
    name: z.string(),
    type: z.enum(['property_type', 'location', 'operation', 'budget', 'feature', 'custom']),
    value: z.string().nullable(),
  })).describe('Intereses identificados del lead'),
});

type LeadAnalysisResult = z.infer<typeof leadAnalysisSchema>;

// Create the queue instance
let conversationQueue: Queue<ConversationCloseJobData> | null = null;

/**
 * Get or create the conversation queue
 */
export function getConversationQueue(): Queue<ConversationCloseJobData> {
  if (!conversationQueue) {
    conversationQueue = new Queue<ConversationCloseJobData>(CONVERSATION_QUEUE_NAME, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    });

    logger.info('[ConversationQueue] Queue created');
  }

  return conversationQueue;
}

/**
 * Generate job ID for a conversation
 */
function getJobId(uid: string, phone: string, conversationId: string): string {
  return `close-${uid}-${phone}-${conversationId}`;
}

/**
 * Schedule a conversation close job
 * Cancels any existing job for this conversation and schedules a new one
 */
export async function scheduleConversationClose(
  uid: string,
  phone: string,
  conversationId: string,
  customerName: string
): Promise<void> {
  const queue = getConversationQueue();
  const jobId = getJobId(uid, phone, conversationId);

  try {
    // Cancel existing job if any
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
      logger.info(`[ConversationQueue] Cancelled existing job ${jobId}`);
    }

    // Schedule new job
    await queue.add(
      'close-conversation',
      {
        uid,
        phone,
        conversationId,
        customerName,
        scheduledAt: Date.now(),
      },
      {
        jobId,
        delay: CONVERSATION_TIMEOUT_MS,
      }
    );

    logger.info(`[ConversationQueue] Scheduled close job ${jobId} for ${CONVERSATION_TIMEOUT_MS / 60000}min`);
  } catch (error) {
    logger.err(`[ConversationQueue] Error scheduling job ${jobId}:`, error);
    throw error;
  }
}

/**
 * Cancel a scheduled conversation close job
 */
export async function cancelConversationClose(
  uid: string,
  phone: string,
  conversationId: string
): Promise<boolean> {
  const queue = getConversationQueue();
  const jobId = getJobId(uid, phone, conversationId);

  try {
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
      logger.info(`[ConversationQueue] Cancelled job ${jobId}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.err(`[ConversationQueue] Error cancelling job ${jobId}:`, error);
    return false;
  }
}

/**
 * Get all messages from all conversations for a customer
 */
async function getAllCustomerMessages(
  uid: string,
  phone: string
): Promise<Array<{ role: string; content: string; timestamp: any; isContext?: boolean }>> {
  const allMessages: Array<{ role: string; content: string; timestamp: any; isContext?: boolean }> = [];

  try {
    // Get all conversations for this customer
    const conversationsSnapshot = await db
      .collection(`users/${uid}/customers/${phone}/conversations`)
      .get();

    // Get messages from each conversation
    for (const convDoc of conversationsSnapshot.docs) {
      const messagesSnapshot = await db
        .collection(`users/${uid}/customers/${phone}/conversations/${convDoc.id}/messages`)
        .orderBy('timestamp', 'asc')
        .get();

      for (const msgDoc of messagesSnapshot.docs) {
        const data = msgDoc.data();
        allMessages.push({
          role: data.role,
          content: data.content,
          timestamp: data.timestamp?.toDate?.() || data.timestamp,
          isContext: data.isContext || false,
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
    logger.err(`[ConversationQueue] Error getting all messages for ${phone}:`, error);
    return [];
  }
}

/**
 * Get messages from a specific conversation
 */
async function getConversationMessages(
  uid: string,
  phone: string,
  conversationId: string
): Promise<Array<{ role: string; content: string; timestamp: any; isContext?: boolean }>> {
  try {
    const messagesSnapshot = await db
      .collection(`users/${uid}/customers/${phone}/conversations/${conversationId}/messages`)
      .orderBy('timestamp', 'asc')
      .get();

    return messagesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        role: data.role,
        content: data.content,
        timestamp: data.timestamp?.toDate?.() || data.timestamp,
        isContext: data.isContext || false,
      };
    });
  } catch (error) {
    logger.err(`[ConversationQueue] Error getting messages for ${conversationId}:`, error);
    return [];
  }
}

/**
 * Generate conversation summary as a list of propositions
 * Each proposition describes an action, query, or data exchange in order of execution
 */
async function generateDetailedSummary(
  messages: Array<{ role: string; content: string; timestamp: any; isContext?: boolean }>,
  customerName: string
): Promise<ConversationSummaryResult | null> {
  try {
    if (messages.length === 0) {
      logger.info('[ConversationQueue] No messages to summarize');
      return null;
    }

    // Separate context messages (tool executions) from conversation messages
    const contextMessages = messages.filter((m) => m.isContext || m.content.includes('tool executed:'));
    const conversationMessages = messages.filter(
      (m) => !m.isContext && !m.content.includes('tool executed:') && m.role !== 'system'
    );

    // Format conversation messages
    const formattedConversation = conversationMessages
      .map((m) => `${m.role === 'user' ? customerName : 'Asistente'}: ${m.content}`)
      .join('\n');

    // Format context messages (tool executions with details)
    const formattedContext = contextMessages
      .map((m) => m.content)
      .join('\n');

    const prompt = `<task>
Genera proposiciones CONCISAS y TÉCNICAS de lo ocurrido en la conversación. Enfócate en acciones y datos.

<reglas>
1. Máximo 15-20 palabras por proposición
2. SIEMPRE incluir IDs exactos (property_id, visit_id) cuando estén en los logs
3. Formato técnico con metadata clara entre corchetes
4. Solo acciones relevantes, no saludos ni cortesías
5. Incluir: herramienta usada, parámetros clave, resultado, IDs
6. Usar formato [metadata] para datos importantes
</reglas>

<formato_ejemplo>
- "Usuario solicita alquiler en Pacheco."
- "Búsqueda (search_properties_rag): alquiler, Pacheco. [resultados: 1]"
- "Propiedad mostrada: Casa Pacheco [property_id: abc123] [precio: $1.230.000/mes] [2 dorm, 1 baño]"
- "Usuario solicita visita para próxima semana."
- "Visita cancelada (cancel_visit): [property_id: abc123] [fecha: 28/11 11:00hs]"
- "Nueva visita creada (create_new_property_visit): [property_id: abc123] [fecha: 01/12 18:00hs] [visit_id: xyz789]"
- "Consulta al dueño (get_help): disponibilidad 01/12 18:00hs [property_id: abc123]"
- "Dueño confirma disponibilidad. Visita confirmada."
- "Intereses usuario: [operación: alquiler] [tipo: casa] [zona: Pacheco]"
</formato_ejemplo>

<conversacion>
${formattedConversation}
</conversacion>

<logs_herramientas>
${formattedContext || 'Sin herramientas ejecutadas'}
</logs_herramientas>

<importante>
- Extrae IDs EXACTOS de los logs (property_id, visit_id, etc.)
- Si un ID aparece en los logs, DEBE aparecer en la proposición entre [corchetes]
- No incluyas saludos, despedidas ni conversación trivial
- Prioriza: búsquedas, propiedades mostradas, visitas, consultas al dueño
- Usa [corchetes] para metadata: IDs, precios, fechas, cantidades
</importante>
</task>`;

    const model = getModel(AI_CONFIG?.LEAD_QUALIFICATION_MODEL ?? 'openai/gpt-4o-mini');
    const { object: result } = await generateObject({
      model: model as any,
      schema: conversationSummarySchema,
      prompt,
      temperature: 0.2,
    });

    return result;
  } catch (error) {
    logger.err('[ConversationQueue] Error generating detailed summary:', error);
    console.log('error generating summary', error);
    return null;
  }
}

/**
 * Analyze lead using AI with enriched schema
 */
async function analyzeLead(
  messages: Array<{ role: string; content: string; timestamp: any; isContext?: boolean }>,
  customerName: string
): Promise<LeadAnalysisResult | null> {
  try {
    if (messages.length === 0) {
      logger.info('[ConversationQueue] No messages to analyze');
      return null;
    }

    // Separate context messages (tool executions) from conversation messages
    const contextMessages = messages.filter((m) => m.isContext || m.content.includes('tool executed:'));
    const conversationMessages = messages.filter(
      (m) => !m.isContext && !m.content.includes('tool executed:') && m.role !== 'system'
    );

    // Format conversation messages
    const formattedConversation = conversationMessages
      .map((m) => `${m.role === 'user' ? customerName : 'Asistente'}: ${m.content}`)
      .join('\n');

    // Format context messages (property lookups, searches, etc.)
    const formattedContext = contextMessages
      .map((m) => m.content)
      .join('\n');

    const prompt = `<task>
Eres un experto en calificación de leads inmobiliarios usando el framework BANT adaptado al sector.
Analiza la siguiente conversación y genera una calificación detallada con preferencias e información de propiedades consultadas.

<conversacion>
${formattedConversation}
</conversacion>

${formattedContext ? `<contexto_herramientas>
Información de herramientas ejecutadas durante la conversación (búsquedas de propiedades, consultas, etc.):
${formattedContext}
</contexto_herramientas>` : ''}

<framework_bant>
**Budget (Presupuesto)** - 25 puntos máximo
- Presupuesto específico y acorde al mercado: 25pts
- Presupuesto vago pero en rango: 15pts
- Sin presupuesto claro: 5pts
- Presupuesto muy bajo para lo que busca: 0pts

**Authority (Autoridad)** - 15 puntos máximo
- Decisor único o con pareja involucrada: 15pts
- Consulta con otros pero participa activamente: 10pts
- Solo recopilando información para terceros: 5pts

**Need (Necesidad)** - 20 puntos máximo
- Necesidad específica y bien definida: 20pts
- Necesidad general pero clara: 12pts
- Explorando opciones sin claridad: 5pts

**Timeline (Urgencia)** - 25 puntos máximo
- Necesita en menos de 30 días: 25pts
- Entre 1-3 meses: 20pts
- Entre 3-6 meses: 10pts
- Más de 6 meses o sin urgencia: 5pts

**Engagement** - 15 puntos máximo
- Alta interacción, responde rápido, hace preguntas de calidad: 15pts
- Interacción media: 8pts
- Respuestas cortas o esporádicas: 3pts
</framework_bant>

<clasificacion>
- 90-100 puntos: Lead Caliente (caliente)
- 70-89 puntos: Lead Tibio (tibio)
- 50-69 puntos: Lead Frío (frío)
- 0-49 puntos: Lead Muy Frío (muy_frío)
</clasificacion>

<instrucciones>
1. Analiza cada mensaje del usuario buscando señales BANT
2. Asigna scores según el framework
3. Identifica señales positivas y negativas específicas (citas textuales cortas)
4. Extrae PREFERENCIAS del lead:
   - Tipo de operación (compra, alquiler, inversión)
   - Tipos de propiedad preferidos
   - Ubicaciones de interés
   - Rango de precios si se menciona
   - Características deseadas (cochera, balcón, etc.)
   - Dormitorios/baños si se mencionan
5. De los mensajes de contexto (herramientas), extrae las PROPIEDADES CONSULTADAS:
   - ID de la propiedad (property_id)
   - Nombre/título
   - Descripción breve
   - Qué preguntó sobre cada una (precio, disponibilidad, visita)
6. Genera TAGS CATEGORIZADOS:
   - operation: tags relacionados con tipo de operación
   - propertyType: tags de tipo de propiedad
   - location: tags de ubicaciones
   - budget: tags de presupuesto
   - timeline: tags de urgencia
   - custom: otros tags relevantes
7. Extrae intereses generales del usuario
8. Escribe un resumen breve de la conversación
9. Calcula el score total y determina el leadStage

IMPORTANTE: Sé objetivo y basa tu análisis SOLO en lo que está en la conversación y contexto. No asumas información.
</instrucciones>
</task>`;

    const model = getModel(AI_CONFIG?.LEAD_QUALIFICATION_MODEL ?? 'openai/gpt-4o-mini');
    const { object: result } = await generateObject({
      model: model as any,
      schema: leadAnalysisSchema,
      prompt,
      temperature: 0.3,
    });

    return result;
  } catch (error) {
    logger.err('[ConversationQueue] Error analyzing lead:', error);
    console.log('error', error);
    return null;
  }
}

/**
 * Close a conversation and update customer with analysis
 */
async function closeConversation(data: ConversationCloseJobData): Promise<boolean> {
  const { uid, phone, conversationId, customerName } = data;

  try {
    const conversationRef = db.doc(`users/${uid}/customers/${phone}/conversations/${conversationId}`);
    const conversationSnapshot = await conversationRef.get();

    if (!conversationSnapshot.exists) {
      logger.info(`[ConversationQueue] Conversation ${conversationId} not found`);
      return false;
    }

    const conversationData = conversationSnapshot.data();

    // Skip if already closed
    if (conversationData?.isOpen === false) {
      logger.info(`[ConversationQueue] Conversation ${conversationId} already closed`);
      return false;
    }

    // Verify inactivity - check if last message is still old enough
    // const lastMessageAt = conversationData?.lastMessageAt?.toDate?.() || conversationData?.lastMessageAt;
    // if (lastMessageAt) {
    //   const now = Date.now();
    //   const lastTime = lastMessageAt instanceof Date ? lastMessageAt.getTime() : new Date(lastMessageAt).getTime();
    //   const timeSinceLastMessage = now - lastTime;

    //   if (timeSinceLastMessage < CONVERSATION_TIMEOUT_MS - 60000) { // 1 min tolerance
    //     logger.info(`[ConversationQueue] Conversation ${conversationId} had recent activity, skipping`);
    //     return false;
    //   }
    // }

    // Get messages from this conversation for summary
    const conversationMessages = await getConversationMessages(uid, phone, conversationId);
    
    console.log('conversationMessages', conversationMessages.length);
    // Get ALL messages from ALL conversations for full BANT analysis
    const allMessages = await getAllCustomerMessages(uid, phone);

    console.log('allMessages', allMessages.length);

    // Generate detailed summary for this conversation
    logger.info(`[ConversationQueue] Generating detailed summary for conversation ${conversationId}`);
    const detailedSummary = await generateDetailedSummary(conversationMessages, customerName || phone);

    // Close the conversation with detailed summary
    const conversationUpdateData: Record<string, any> = {
      isOpen: false,
      closedAt: FieldValue.serverTimestamp(),
    };

    // Add summary as joined propositions text
    if (detailedSummary && detailedSummary.propositions.length > 0) {
      // Join propositions with line breaks to create a readable summary text
      const summaryText = detailedSummary.propositions.join('\n');
      conversationUpdateData.summary = summaryText;
      
      logger.info(`[ConversationQueue] Summary generated with ${detailedSummary.propositions.length} propositions`);
      logger.info(`[ConversationQueue] Summary preview: ${summaryText.substring(0, 200)}...`);
    }

    await conversationRef.update(conversationUpdateData);

    // Clear activeConversationId from customer
    const customerRef = db.doc(`users/${uid}/customers/${phone}`);
    await customerRef.update({
      activeConversationId: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Skip lead analysis if not enough messages
    const userMessages = allMessages.filter((m) => m.role === 'user' && !m.isContext);
    if (userMessages.length < 2) {
      logger.info(`[ConversationQueue] Not enough messages for lead analysis (${userMessages.length})`);
      return true;
    }

    // Analyze the lead (BANT scoring)
    logger.info(`[ConversationQueue] Analyzing lead ${phone} with ${allMessages.length} total messages`);
    const analysis = await analyzeLead(allMessages, customerName || phone);

    if (!analysis) {
      logger.err(`[ConversationQueue] Failed to analyze lead ${phone}`);
      return true; // Conversation was closed, just no analysis
    }

    // Update customer with full analysis
    const customerSnapshot = await customerRef.get();
    const existingInterests = customerSnapshot.data()?.interests || [];

    // Merge new interests with existing (avoid duplicates)
    const newInterests = analysis.interests.filter(
      (newInt) => !existingInterests.some((existing: any) => existing.name === newInt.name)
    );

    const mergedInterests = [
      ...existingInterests,
      ...newInterests.map((i) => ({
        id: `interest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: i.name,
        type: i.type,
        value: i.value,
        createdAt: new Date(), // Can't use FieldValue.serverTimestamp() inside arrays
      })),
    ];

    // Merge properties viewed with existing
    const existingPropertiesViewed = customerSnapshot.data()?.propertiesViewed || [];
    const newPropertiesViewed = analysis.propertiesViewed.filter(
      (newProp) => !existingPropertiesViewed.some((existing: any) => existing.propertyId === newProp.propertyId)
    );

    const mergedPropertiesViewed = [
      ...existingPropertiesViewed,
      ...newPropertiesViewed.map((p) => ({
        ...p,
        viewedAt: new Date(), // Can't use FieldValue.serverTimestamp() inside arrays
      })),
    ];

    await customerRef.update({
      // BANT Qualification
      qualification: {
        intentionScore: analysis.intentionScore,
        economicCapacity: analysis.economicCapacity,
        urgencyScore: analysis.urgencyScore,
        engagementScore: analysis.engagementScore,
        positiveSignals: analysis.positiveSignals,
        negativeSignals: analysis.negativeSignals,
        leadStage: analysis.leadStage,
        bantScores: analysis.bantScores,
        totalScore: analysis.totalScore,
        analyzedAt: FieldValue.serverTimestamp(),
      },
      // Preferences
      preferences: analysis.preferences,
      // Properties viewed
      propertiesViewed: mergedPropertiesViewed,
      // Tags
      tags: analysis.tags,
      // Interests
      interests: mergedInterests,
      // Latest qualification summary
      latestQualification: {
        leadStage: analysis.leadStage,
        totalScore: analysis.totalScore,
        analyzedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info(
      `[ConversationQueue] Successfully closed and analyzed ${phone}: ${analysis.leadStage} (${analysis.totalScore}/100)`
    );
    return true;
  } catch (error) {
    logger.err(`[ConversationQueue] Error closing conversation ${conversationId}:`, error);
    console.log('error', error);
    return false;
  }
}

// Worker instance
let conversationWorker: Worker<ConversationCloseJobData> | null = null;

/**
 * Start the conversation close worker
 */
export function startConversationWorker(): Worker<ConversationCloseJobData> {
  if (conversationWorker) {
    return conversationWorker;
  }

  conversationWorker = new Worker<ConversationCloseJobData>(
    CONVERSATION_QUEUE_NAME,
    async (job: Job<ConversationCloseJobData>) => {
      logger.info(`[ConversationWorker] Processing job ${job.id}`);
      const success = await closeConversation(job.data);
      if (!success) {
        logger.warn(`[ConversationWorker] Job ${job.id} completed but no action taken`);
      }
      return success;
    },
    {
      connection: getQueueConnection(),
      concurrency: 5,
    }
  );

  conversationWorker.on('completed', (job) => {
    logger.info(`[ConversationWorker] Job ${job.id} completed`);
  });

  conversationWorker.on('failed', (job, err) => {
    logger.err(`[ConversationWorker] Job ${job?.id} failed: ${err?.message || err}`);
  });

  conversationWorker.on('error', (err) => {
    logger.err(`[ConversationWorker] Worker error: ${err?.message || err}`);
  });

  logger.info('[ConversationWorker] Worker started');
  return conversationWorker;
}

/**
 * Stop the conversation worker
 */
export async function stopConversationWorker(): Promise<void> {
  if (conversationWorker) {
    await conversationWorker.close();
    conversationWorker = null;
    logger.info('[ConversationWorker] Worker stopped');
  }
}

/**
 * Close the queue
 */
export async function closeConversationQueue(): Promise<void> {
  if (conversationQueue) {
    await conversationQueue.close();
    conversationQueue = null;
    logger.info('[ConversationQueue] Queue closed');
  }
}

