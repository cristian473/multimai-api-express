import logger from 'jet-logger';
import { db, admin } from '../db/firebase';
import { generateObject } from 'ai';
import { getModel } from '../ai/openrouter';
import { AI_CONFIG } from '../ai/config';
import { z } from 'zod';

const FieldValue = admin.firestore.FieldValue;

// Constants
const CONVERSATION_TIMEOUT_HOURS = 4;
const BATCH_SIZE = 10;

// Lead qualification schema based on BANT framework
const leadQualificationSchema = z.object({
  intencion_score: z.number().min(0).max(10).describe('Score de intención de compra/alquiler (0-10)'),
  capacidad_economica: z.enum(['alta', 'media', 'baja', 'desconocida']).describe('Capacidad económica del lead'),
  urgencia_score: z.number().min(0).max(10).describe('Score de urgencia/timeline (0-10)'),
  engagement_score: z.number().min(0).max(10).describe('Score de engagement/interacción (0-10)'),
  señales_positivas: z.array(z.string()).describe('Lista de señales positivas detectadas'),
  señales_negativas: z.array(z.string()).describe('Lista de señales negativas detectadas'),
  lead_stage: z.enum(['caliente', 'tibio', 'frío', 'muy_frío']).describe('Etapa del lead'),
  bant_scores: z.object({
    budget: z.number().min(0).max(25).describe('Score de presupuesto (0-25)'),
    authority: z.number().min(0).max(15).describe('Score de autoridad para decidir (0-15)'),
    need: z.number().min(0).max(20).describe('Score de necesidad definida (0-20)'),
    timeline: z.number().min(0).max(25).describe('Score de urgencia/timeline (0-25)'),
    engagement: z.number().min(0).max(15).describe('Score de engagement (0-15)'),
  }).describe('Scores detallados BANT'),
  total_score: z.number().min(0).max(100).describe('Score total (0-100)'),
  conversation_tags: z.array(z.string()).describe('Tags relevantes de la conversación'),
  summary: z.string().describe('Resumen breve de la conversación'),
  interests: z.array(z.object({
    name: z.string(),
    type: z.enum(['property_type', 'location', 'operation', 'budget', 'feature', 'custom']),
    value: z.string().optional(),
  })).describe('Intereses identificados del lead'),
});

type LeadQualificationResult = z.infer<typeof leadQualificationSchema>;

/**
 * Get the date key for today in DDMMYYYY format
 */
function getTodayDateKey(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}${month}${year}`;
}

/**
 * Check if a conversation is inactive (no messages for CONVERSATION_TIMEOUT_HOURS)
 */
function isConversationInactive(lastMessageAt: Date): boolean {
  const now = new Date();
  const hoursDiff = (now.getTime() - lastMessageAt.getTime()) / (1000 * 60 * 60);
  return hoursDiff >= CONVERSATION_TIMEOUT_HOURS;
}

/**
 * Generate lead qualification using AI
 */
async function qualifyLead(
  messages: Array<{ role: string; content: string; timestamp: any }>,
  customerName: string
): Promise<LeadQualificationResult | null> {
  try {
    if (messages.length === 0) {
      logger.info('[LeadQualification] No messages to qualify');
      return null;
    }

    // Format messages for the prompt
    const formattedMessages = messages
      .map((m) => `${m.role === 'user' ? customerName : 'Asistente'}: ${m.content}`)
      .join('\n');

    const prompt = `<task>
Eres un experto en calificación de leads inmobiliarios usando el framework BANT adaptado al sector.
Analiza la siguiente conversación y genera una calificación detallada.

<conversacion>
${formattedMessages}
</conversacion>

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

<señales_positivas_ejemplo>
- "Necesito mudarme para [fecha]"
- "Mi presupuesto es de [monto específico]"
- "Estoy vendiendo mi propiedad actual"
- "¿Cuándo puedo ver la propiedad?"
- "¿Qué documentación necesito para reservar?"
- "Tengo pre-aprobado un crédito de..."
- "Busco departamento de 2 dormitorios en [zona]"
- "Trabajo en [zona] y necesito algo cerca"
</señales_positivas_ejemplo>

<señales_negativas_ejemplo>
- "Solo estoy mirando"
- "Es para dentro de mucho tiempo"
- "Todavía no sé si voy a comprar o alquilar"
- Respuestas monosilábicas
- No responde a preguntas sobre presupuesto o timing
</señales_negativas_ejemplo>

<instrucciones>
1. Analiza cada mensaje del usuario buscando señales BANT
2. Asigna scores según el framework
3. Identifica señales positivas y negativas específicas (citas textuales cortas)
4. Extrae intereses del usuario (tipo de propiedad, ubicación, operación, presupuesto, características)
5. Genera tags relevantes para categorizar la conversación
6. Escribe un resumen breve de la conversación
7. Calcula el score total y determina el lead_stage

IMPORTANTE: Sé objetivo y basa tu análisis SOLO en lo que el usuario ha dicho. No asumas información que no está en la conversación.
</instrucciones>
</task>`;

    const model = getModel(AI_CONFIG?.LEAD_QUALIFICATION_MODEL ?? 'openai/gpt-4o-mini');
    const { object: result } = await generateObject({
      model: model as any,
      schema: leadQualificationSchema,
      prompt,
      temperature: 0.3,
    });

    return result;
  } catch (error) {
    logger.err('[LeadQualification] Error qualifying lead:', error);
    return null;
  }
}

/**
 * Process a single conversation for qualification
 */
async function processConversation(
  uid: string,
  phone: string,
  dateKey: string,
  customerName: string
): Promise<boolean> {
  try {
    const conversationRef = db.doc(`users/${uid}/customers/${phone}/conversations/${dateKey}`);
    const conversationSnapshot = await conversationRef.get();

    if (!conversationSnapshot.exists) {
      return false;
    }

    const conversationData = conversationSnapshot.data();

    // Skip if already qualified
    if (conversationData?.is_closed && conversationData?.qualification) {
      logger.info(`[LeadQualification] Conversation ${phone}/${dateKey} already qualified, skipping`);
      return false;
    }

    // Get last message timestamp
    const lastMessageAt = conversationData?.last_message_at?.toDate?.() || conversationData?.last_message_at;
    if (!lastMessageAt || !isConversationInactive(new Date(lastMessageAt))) {
      logger.info(`[LeadQualification] Conversation ${phone}/${dateKey} is still active`);
      return false;
    }

    // Get all messages
    const messagesSnapshot = await db
      .collection(`users/${uid}/customers/${phone}/conversations/${dateKey}/messages`)
      .orderBy('timestamp', 'asc')
      .get();

    if (messagesSnapshot.empty) {
      logger.info(`[LeadQualification] No messages found for ${phone}/${dateKey}`);
      return false;
    }

    const messages = messagesSnapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          role: data.role,
          content: data.content,
          timestamp: data.timestamp?.toDate?.() || data.timestamp,
        };
      })
      .filter((m) => !m.content.includes('tool executed:') && m.role !== 'system');

    // Skip if not enough user messages
    const userMessages = messages.filter((m) => m.role === 'user');
    if (userMessages.length < 2) {
      logger.info(`[LeadQualification] Not enough user messages for ${phone}/${dateKey}`);
      // Mark as closed but without qualification
      await conversationRef.update({
        is_closed: true,
        closed_at: FieldValue.serverTimestamp(),
      });
      return true;
    }

    // Qualify the lead
    logger.info(`[LeadQualification] Qualifying conversation ${phone}/${dateKey} with ${messages.length} messages`);
    const qualification = await qualifyLead(messages, customerName || phone);

    if (!qualification) {
      logger.err(`[LeadQualification] Failed to qualify ${phone}/${dateKey}`);
      return false;
    }

    // Update conversation with qualification
    await conversationRef.update({
      is_closed: true,
      closed_at: FieldValue.serverTimestamp(),
      qualification: {
        intencion_score: qualification.intencion_score,
        capacidad_economica: qualification.capacidad_economica,
        urgencia_score: qualification.urgencia_score,
        engagement_score: qualification.engagement_score,
        señales_positivas: qualification.señales_positivas,
        señales_negativas: qualification.señales_negativas,
        lead_stage: qualification.lead_stage,
        bant_scores: qualification.bant_scores,
        total_score: qualification.total_score,
        analyzed_at: FieldValue.serverTimestamp(),
      },
      tags: qualification.conversation_tags,
      summary: qualification.summary,
    });

    // Update customer with interests and latest qualification
    const customerRef = db.doc(`users/${uid}/customers/${phone}`);
    const customerSnapshot = await customerRef.get();

    if (customerSnapshot.exists) {
      const existingInterests = customerSnapshot.data()?.interests || [];
      
      // Merge new interests with existing (avoid duplicates)
      const newInterests = qualification.interests.filter(
        (newInt) => !existingInterests.some((existing: any) => existing.name === newInt.name)
      );
      
      const mergedInterests = [
        ...existingInterests,
        ...newInterests.map((i) => ({
          id: `interest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: i.name,
          type: i.type,
          value: i.value,
          created_at: FieldValue.serverTimestamp(),
        })),
      ];

      await customerRef.update({
        interests: mergedInterests,
        latest_qualification: {
          lead_stage: qualification.lead_stage,
          total_score: qualification.total_score,
          analyzed_at: FieldValue.serverTimestamp(),
        },
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    logger.info(
      `[LeadQualification] Successfully qualified ${phone}/${dateKey}: ${qualification.lead_stage} (${qualification.total_score}/100)`
    );
    return true;
  } catch (error) {
    logger.err(`[LeadQualification] Error processing conversation ${phone}/${dateKey}:`, error);
    return false;
  }
}

/**
 * Get all users with agent enabled
 */
async function getActiveUsers(): Promise<Array<{ uid: string }>> {
  try {
    const usersSnapshot = await db
      .collection('users')
      .where('agent.isActive', '==', true)
      .get();

    return usersSnapshot.docs.map((doc) => ({ uid: doc.id }));
  } catch (error) {
    logger.err('[LeadQualification] Error getting active users:', error);
    return [];
  }
}

/**
 * Get conversations that need qualification for a user
 */
async function getConversationsToQualify(
  uid: string
): Promise<Array<{ phone: string; dateKey: string; customerName: string }>> {
  try {
    const conversationsToQualify: Array<{ phone: string; dateKey: string; customerName: string }> = [];
    const today = getTodayDateKey();

    // Get all customers
    const customersSnapshot = await db.collection(`users/${uid}/customers`).get();

    for (const customerDoc of customersSnapshot.docs) {
      const phone = customerDoc.id;
      const customerData = customerDoc.data();
      const customerName = customerData.name || phone;

      // Get conversations for this customer that are not closed
      const conversationsSnapshot = await db
        .collection(`users/${uid}/customers/${phone}/conversations`)
        .where('is_closed', '==', false)
        .get();

      // Also check conversations without the is_closed field (older ones)
      const uncheckedConversationsSnapshot = await db
        .collection(`users/${uid}/customers/${phone}/conversations`)
        .get();

      const processedDates = new Set<string>();

      // Process explicitly open conversations
      for (const convDoc of conversationsSnapshot.docs) {
        const dateKey = convDoc.id;
        if (!processedDates.has(dateKey)) {
          processedDates.add(dateKey);
          conversationsToQualify.push({ phone, dateKey, customerName });
        }
      }

      // Process conversations that might not have is_closed field
      for (const convDoc of uncheckedConversationsSnapshot.docs) {
        const dateKey = convDoc.id;
        const convData = convDoc.data();

        // Skip if already processed or already closed
        if (processedDates.has(dateKey) || convData.is_closed) {
          continue;
        }

        // Check if has last_message_at and is inactive
        const lastMessageAt = convData.last_message_at?.toDate?.() || convData.last_message_at;
        if (lastMessageAt && isConversationInactive(new Date(lastMessageAt))) {
          processedDates.add(dateKey);
          conversationsToQualify.push({ phone, dateKey, customerName });
        }
      }
    }

    return conversationsToQualify;
  } catch (error) {
    logger.err(`[LeadQualification] Error getting conversations for user ${uid}:`, error);
    return [];
  }
}

/**
 * Main function to process lead qualification
 */
export async function processLeadQualification(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const stats = { processed: 0, succeeded: 0, failed: 0 };

  try {
    logger.info('[LeadQualification] Starting lead qualification process...');

    // Get all active users
    const users = await getActiveUsers();
    logger.info(`[LeadQualification] Found ${users.length} active users`);

    for (const { uid } of users) {
      // Get conversations to qualify for this user
      const conversationsToQualify = await getConversationsToQualify(uid);
      logger.info(
        `[LeadQualification] Found ${conversationsToQualify.length} conversations to qualify for user ${uid}`
      );

      // Process in batches
      for (let i = 0; i < conversationsToQualify.length; i += BATCH_SIZE) {
        const batch = conversationsToQualify.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async ({ phone, dateKey, customerName }) => {
            stats.processed++;
            const success = await processConversation(uid, phone, dateKey, customerName);
            if (success) {
              stats.succeeded++;
            } else {
              stats.failed++;
            }
          })
        );

        // Small delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < conversationsToQualify.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    logger.info(
      `[LeadQualification] Completed. Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}`
    );
    return stats;
  } catch (error) {
    logger.err('[LeadQualification] Error in lead qualification process:', error);
    return stats;
  }
}

