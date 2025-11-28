/**
 * Lead Qualification Cron Job
 * Fallback for orphan conversations not processed by the sliding window system
 * 
 * This runs periodically to catch:
 * - Conversations from old schema (DDMMYYYY format)
 * - Conversations that somehow missed the BullMQ job
 * - Conversations where Redis/BullMQ was unavailable
 */

import logger from 'jet-logger';
import { db, admin } from '../db/firebase';
import { generateObject } from 'ai';
import { getModel } from '../ai/openrouter';
import { AI_CONFIG } from '../ai/config';
import { z } from 'zod';
import { CONVERSATION_TIMEOUT_HOURS, MIN_MESSAGES_FOR_SUMMARY } from '../../config/constants';

const FieldValue = admin.firestore.FieldValue;

// Constants
const BATCH_SIZE = 10;

// Legacy lead qualification schema for old conversations
const legacyLeadQualificationSchema = z.object({
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
  conversationTags: z.array(z.string()).describe('Tags relevantes de la conversación'),
  summary: z.string().describe('Resumen breve de la conversación'),
  interests: z.array(z.object({
    name: z.string(),
    type: z.enum(['property_type', 'location', 'operation', 'budget', 'feature', 'custom']),
    value: z.string().nullable(),
  })).describe('Intereses identificados del lead'),
  // New fields for enriched analysis
  preferences: z.object({
    operationType: z.array(z.string()),
    propertyTypes: z.array(z.string()),
    locations: z.array(z.string()),
    priceRange: z.object({
      min: z.number().nullable(),
      max: z.number().nullable(),
      currency: z.string()
    }).nullable(),
    features: z.array(z.string()),
    bedrooms: z.number().nullable(),
    bathrooms: z.number().nullable(),
  }),
  propertiesViewed: z.array(z.object({
    propertyId: z.string(),
    name: z.string(),
    description: z.string(),
    askedAbout: z.array(z.string())
  })),
  tags: z.object({
    operation: z.array(z.string()),
    propertyType: z.array(z.string()),
    location: z.array(z.string()),
    budget: z.array(z.string()),
    timeline: z.array(z.string()),
    custom: z.array(z.string())
  }),
});

type LeadQualificationResult = z.infer<typeof legacyLeadQualificationSchema>;

/**
 * Get the date key for today in DDMMYYYY format (legacy)
 */
function getTodayDateKey(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}${month}${year}`;
}

/**
 * Check if a conversation is inactive
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

    // Separate context messages from conversation messages
    const contextMessages = messages.filter((m) => m.content.includes('tool executed:'));
    const conversationMessages = messages.filter(
      (m) => !m.content.includes('tool executed:') && m.role !== 'system'
    );

    const formattedMessages = conversationMessages
      .map((m) => `${m.role === 'user' ? customerName : 'Asistente'}: ${m.content}`)
      .join('\n');

    const contextText = contextMessages.length > 0
      ? `\n\n<contexto_herramientas>\n${contextMessages.map(m => m.content).join('\n')}\n</contexto_herramientas>`
      : '';

    const prompt = `<task>
Eres un experto en calificación de leads inmobiliarios usando el framework BANT adaptado al sector.
Analiza la siguiente conversación y genera una calificación detallada.

<conversacion>
${formattedMessages}
</conversacion>
${contextText}

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
4. Extrae intereses del usuario (tipo de propiedad, ubicación, operación, presupuesto, características)
5. Si hay mensajes de contexto (herramientas), extrae información de propiedades consultadas
6. Genera tags relevantes para categorizar la conversación
7. Escribe un resumen breve de la conversación
8. Calcula el score total y determina el leadStage

IMPORTANTE: Sé objetivo y basa tu análisis SOLO en lo que el usuario ha dicho. No asumas información que no está en la conversación.
</instrucciones>
</task>`;

    const model = getModel(AI_CONFIG?.LEAD_QUALIFICATION_MODEL ?? 'openai/gpt-4o-mini');
    const { object: result } = await generateObject({
      model: model as any,
      schema: legacyLeadQualificationSchema,
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
 * Process a single conversation for qualification (legacy + new schema support)
 */
async function processConversation(
  uid: string,
  phone: string,
  conversationId: string,
  customerName: string
): Promise<boolean> {
  try {
    const conversationRef = db.doc(`users/${uid}/customers/${phone}/conversations/${conversationId}`);
    const conversationSnapshot = await conversationRef.get();

    if (!conversationSnapshot.exists) {
      return false;
    }

    const conversationData = conversationSnapshot.data();

    // Skip if already qualified/closed (new schema)
    if (conversationData?.isOpen === false && conversationData?.summary) {
      logger.info(`[LeadQualification] Conversation ${phone}/${conversationId} already processed`);
      return false;
    }

    // Skip if already qualified (legacy schema)
    if (conversationData?.is_closed && conversationData?.qualification) {
      logger.info(`[LeadQualification] Conversation ${phone}/${conversationId} already qualified`);
      return false;
    }

    // Get last message timestamp (handle both schemas)
    const lastMessageAt = conversationData?.lastMessageAt?.toDate?.() 
      || conversationData?.last_message_at?.toDate?.() 
      || conversationData?.lastMessageAt 
      || conversationData?.last_message_at;

    if (!lastMessageAt || !isConversationInactive(new Date(lastMessageAt))) {
      logger.info(`[LeadQualification] Conversation ${phone}/${conversationId} is still active`);
      return false;
    }

    // Get all messages from this conversation
    const messagesSnapshot = await db
      .collection(`users/${uid}/customers/${phone}/conversations/${conversationId}/messages`)
      .orderBy('timestamp', 'asc')
      .get();

    if (messagesSnapshot.empty) {
      logger.info(`[LeadQualification] No messages found for ${phone}/${conversationId}`);
      return false;
    }

    const messages = messagesSnapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          role: data.role,
          content: data.content,
          timestamp: data.timestamp?.toDate?.() || data.timestamp,
          isContext: data.isContext || false,
        };
      })
      .filter((m) => m.role !== 'system');

    // Skip if not enough user messages
    const userMessages = messages.filter((m) => m.role === 'user' && !m.isContext);
    if (userMessages.length < 2) {
      logger.info(`[LeadQualification] Not enough user messages for ${phone}/${conversationId}`);
      // Mark as closed but without qualification
      await conversationRef.update({
        isOpen: false,
        is_closed: true,
        closedAt: FieldValue.serverTimestamp(),
        closed_at: FieldValue.serverTimestamp(),
      });
      return true;
    }

    // Qualify the lead
    logger.info(`[LeadQualification] Qualifying conversation ${phone}/${conversationId} with ${messages.length} messages`);
    const qualification = await qualifyLead(messages, customerName || phone);

    if (!qualification) {
      logger.err(`[LeadQualification] Failed to qualify ${phone}/${conversationId}`);
      return false;
    }

    // Update conversation with qualification
    await conversationRef.update({
      // New schema
      isOpen: false,
      closedAt: FieldValue.serverTimestamp(),
      summary: qualification.summary,
      // Legacy schema compatibility
      is_closed: true,
      closed_at: FieldValue.serverTimestamp(),
      tags: qualification.conversationTags,
    });

    // Update customer with qualification data
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
          createdAt: FieldValue.serverTimestamp(),
        })),
      ];

      // Prepare update data
      const updateData: any = {
        interests: mergedInterests,
        qualification: {
          intentionScore: qualification.intentionScore,
          economicCapacity: qualification.economicCapacity,
          urgencyScore: qualification.urgencyScore,
          engagementScore: qualification.engagementScore,
          positiveSignals: qualification.positiveSignals,
          negativeSignals: qualification.negativeSignals,
          leadStage: qualification.leadStage,
          bantScores: qualification.bantScores,
          totalScore: qualification.totalScore,
          analyzedAt: FieldValue.serverTimestamp(),
        },
        latestQualification: {
          leadStage: qualification.leadStage,
          totalScore: qualification.totalScore,
          analyzedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
        activeConversationId: null, // Clear active conversation
      };

      // Add optional enriched fields if present
      if (qualification.preferences) {
        updateData.preferences = qualification.preferences;
      }
      if (qualification.propertiesViewed && qualification.propertiesViewed.length > 0) {
        const existingProps = customerSnapshot.data()?.propertiesViewed || [];
        const newProps = qualification.propertiesViewed.filter(
          (p) => !existingProps.some((ep: any) => ep.propertyId === p.propertyId)
        );
        updateData.propertiesViewed = [
          ...existingProps,
          ...newProps.map((p) => ({ ...p, viewedAt: FieldValue.serverTimestamp() }))
        ];
      }
      if (qualification.tags) {
        updateData.tags = qualification.tags;
      }

      await customerRef.update(updateData);
    }

    logger.info(
      `[LeadQualification] Successfully qualified ${phone}/${conversationId}: ${qualification.leadStage} (${qualification.totalScore}/100)`
    );
    return true;
  } catch (error) {
    logger.err(`[LeadQualification] Error processing conversation ${phone}/${conversationId}:`, error);
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
 * Get orphan conversations that need qualification
 * These are conversations that:
 * 1. Are marked as open (isOpen: true) but inactive
 * 2. Legacy conversations (with date format) that are not closed
 * 3. Conversations without is_closed or isOpen field
 */
async function getOrphanConversations(
  uid: string
): Promise<Array<{ phone: string; conversationId: string; customerName: string }>> {
  try {
    const conversationsToQualify: Array<{ phone: string; conversationId: string; customerName: string }> = [];
    const today = getTodayDateKey();

    // Get all customers
    const customersSnapshot = await db.collection(`users/${uid}/customers`).get();

    for (const customerDoc of customersSnapshot.docs) {
      const phone = customerDoc.id;
      const customerData = customerDoc.data();
      const customerName = customerData.name || phone;

      // Get all conversations for this customer
      const conversationsSnapshot = await db
        .collection(`users/${uid}/customers/${phone}/conversations`)
        .get();

      for (const convDoc of conversationsSnapshot.docs) {
        const conversationId = convDoc.id;
        const convData = convDoc.data();

        // Skip if already closed/processed
        if (convData.isOpen === false && convData.summary) continue;
        if (convData.is_closed && convData.qualification) continue;

        // Check if has last_message_at and is inactive
        const lastMessageAt = convData.lastMessageAt?.toDate?.() 
          || convData.last_message_at?.toDate?.() 
          || convData.lastMessageAt 
          || convData.last_message_at;

        if (lastMessageAt && isConversationInactive(new Date(lastMessageAt))) {
          conversationsToQualify.push({ phone, conversationId, customerName });
        }
      }
    }

    return conversationsToQualify;
  } catch (error) {
    logger.err(`[LeadQualification] Error getting orphan conversations for user ${uid}:`, error);
    return [];
  }
}

/**
 * Main function to process lead qualification (fallback cron job)
 */
export async function processLeadQualification(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const stats = { processed: 0, succeeded: 0, failed: 0 };

  try {
    logger.info('[LeadQualification] Starting fallback lead qualification process...');

    // Get all active users
    const users = await getActiveUsers();
    logger.info(`[LeadQualification] Found ${users.length} active users`);

    for (const { uid } of users) {
      // Get orphan conversations to qualify for this user
      const orphanConversations = await getOrphanConversations(uid);
      logger.info(
        `[LeadQualification] Found ${orphanConversations.length} orphan conversations for user ${uid}`
      );

      // Process in batches
      for (let i = 0; i < orphanConversations.length; i += BATCH_SIZE) {
        const batch = orphanConversations.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async ({ phone, conversationId, customerName }) => {
            stats.processed++;
            const success = await processConversation(uid, phone, conversationId, customerName);
            if (success) {
              stats.succeeded++;
            } else {
              stats.failed++;
            }
          })
        );

        // Small delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < orphanConversations.length) {
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
