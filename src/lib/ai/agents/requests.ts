import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { db } from "../../db/firebase";
import { getUserConfig } from "../../db/repositories/users";
import { getHistory } from "../../utils/history";
import { getOpenRouterModel } from "../openrouter";

// Prompt simple para extraer el requestId
const EXTRACT_REQUEST_ID_PROMPT = () => `Eres un asistente que extrae el Request ID de los mensajes.

Tu única tarea es identificar si el mensaje contiene un Request ID en el formato "Request ID: xxxxx" y extraerlo.

Si encuentras un Request ID, responde SOLO con el ID extraído.
Si no encuentras un Request ID, responde con "NO_REQUEST_ID".

Ejemplos:
- "Respondiendo al Request ID: abc123" → "abc123"
- "Request ID: xyz-789 - Sí, está disponible" → "xyz-789"
- "Hola, ¿cómo estás?" → "NO_REQUEST_ID"`;

// Prompt completo para procesar la respuesta con todo el contexto
const PROCESS_RESPONSE_PROMPT = (
  businessName: string,
  ownerResponse: string,
  requestContext: {
    question: string;
    recentMessages: Array<{ content: string; chat_message_id?: string }>;
    customerName: string;
    customerPhone: string;
    fullHistory: Array<{ role: string; content: string; chat_message_id?: string }>;
  },
) => `Eres el asistente principal de ${businessName}.

Tu función es ayudar al dueño a procesar su respuesta a una solicitud del cliente.

## Información del Cliente

- Nombre: ${requestContext.customerName}
- Teléfono: ${requestContext.customerPhone}

## Contexto de la Solicitud Original

El cliente había preguntado: "${requestContext.question}"

**Mensajes recientes del contexto de la solicitud:**
${requestContext.recentMessages.map((msg, idx) => 
  `${idx + 1}. "${msg.content}"${msg.chat_message_id ? ` (chat_message_id: ${msg.chat_message_id})` : ''}`
).join('\n')}

## Historial Completo de Conversación

Este es el historial completo de la conversación con este cliente:

${requestContext.fullHistory.map((msg, idx) => 
  `[${msg.role}] ${msg.content}${msg.chat_message_id ? ` (chat_message_id: ${msg.chat_message_id})` : ''}`
).join('\n')}

## Tu única tarea es:

El dueño va a responder a la solicitud del cliente. Debes:
1. Extraer la respuesta del dueño
2. Elegir el chat_message_id más relevante del historial para responder (preferiblemente de los mensajes recientes de la solicitud)
3. Llamar a la herramienta process_owner_response con todos los datos necesarios

## Tu estilo de comunicación

- Hablás como un profesional argentino amable y eficiente
- Sos claro y directo en tus comunicaciones
- Respondés las preguntas de los clientes de forma útil

## Herramientas disponibles

**process_owner_response** - Procesa la respuesta del dueño y la envía al cliente:
- Extrae el requestId y la respuesta del dueño
- Elige el chat_message_id más relevante basándote en el historial completo y los mensajes recientes
- El sistema guardará la respuesta y la enviará al cliente automáticamente
- El cliente podrá continuar la conversación normalmente

### Cómo elegir el chat_message_id:

1. Prioriza los mensajes de los "Mensajes recientes del contexto de la solicitud"
2. Busca el mensaje que mejor representa la pregunta original del cliente
3. Si hay múltiples mensajes, elige el que inició la consulta
4. Revisa el historial completo para contexto adicional si es necesario
5. Si no hay IDs disponibles, omite este parámetro

## Nota importante

- tu única tarea es procesar la respuesta del dueño y enviarla al cliente.

## Respuesta del dueño: ${ownerResponse}
`;

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  chat_message_id?: string;
}

/**
 * Extrae el requestId del mensaje
 * Busca el patrón "Request ID: xxxxx"
 */
function extractRequestId(message: string): string | null {
  const match = message.match(/Request ID:\s*([a-zA-Z0-9]+)/i);
  return match ? match[1] : null;
}

/**
 * Procesa la respuesta del dueño guardándola en el historial de conversación
 * y enviándola al cliente automáticamente.
 * Usa transacciones de Firestore para prevenir condiciones de carrera.
 */
async function processOwnerResponse(
  requestId: string,
  ownerResponse: string,
  replyToMessageId?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    console.log(
      `[processOwnerResponse] Procesando respuesta para request: ${requestId}`,
    );

    const requestRef = db.collection("agents/multimai/requests").doc(requestId);

    // Usar transacción para prevenir condiciones de carrera
    const result = await db.runTransaction(async (transaction) => {
      const requestDoc = await transaction.get(requestRef);

      if (!requestDoc.exists) {
        throw new Error(`Request no encontrado: ${requestId}`);
      }

      const requestData = requestDoc.data();
      
      // Verificar si ya fue procesado
      // if (requestData?.workflowStatus === "responded") {
      //   console.warn(`[processOwnerResponse] ⚠️ Request ${requestId} ya fue respondido`);
      //   return {
      //     success: false,
      //     message: `La solicitud ${requestId} ya fue respondida anteriormente.`,
      //     alreadyProcessed: true as const,
      //     requestData: undefined,
      //   };
      // }

      // Marcar como respondido inmediatamente
      transaction.update(requestRef, {
        workflowStatus: "responded",
        response: ownerResponse,
        respondedAt: new Date(),
      });

      return {
        success: true,
        message: "",
        requestData: requestData as any,
        alreadyProcessed: false as const,
      };
    });

    // Si ya fue procesado, retornar temprano
    if (result.alreadyProcessed) {
      return {
        success: result.success,
        message: result.message,
      };
    }

    const { requestData } = result;
    const { userId, customer } = requestData;
    const customerPhone = customer.phone;

    console.log(`[processOwnerResponse] Cliente: ${customer.name} (${customerPhone})`);
    console.log(`[processOwnerResponse] User id: ${userId}`);

    // Obtener la sesión de WhatsApp del usuario para reactivar el agente
    const userConfig = await getUserConfig(userId);
    
    if (!userConfig) {
      console.error(`[processOwnerResponse] ❌ No se encontró la configuración del usuario`);
      return {
        success: false,
        message: `No se pudo obtener la configuración del usuario`,
      };
    }

    const session = userConfig.config?.session || userId;
    const activateAgentUrl = `${process.env.MULTIMAI_API_URL || 'http://localhost:3000'}/api/ws/activate-agent`;
    
    console.log(`[processOwnerResponse] Reactivando agente via ${activateAgentUrl}`);
    if (replyToMessageId) {
      console.log(`[processOwnerResponse] Responderá al mensaje ID: ${replyToMessageId}`);
    }

    // Disparar el endpoint de forma asíncrona (fire and forget)
    const activatePayload: any = {
      uid: userId,
      session: session,
      userPhone: customerPhone,
      userName: customer.name,
      assistantMessage: `[El dueño respondió] "${ownerResponse}"`,
    };

    if (replyToMessageId) {
      activatePayload.replyToMessageId = replyToMessageId;
    }

    fetch(activateAgentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(activatePayload),
    }).catch(error => {
      console.error(`[processOwnerResponse] ❌ Error al disparar activación:`, error);
    });

    console.log(`[processOwnerResponse] ✅ Procesamiento exitoso`);

    return {
      success: true,
      message: `Solicitud ${requestId} procesada. Agente reactivado.`,
    };
  } catch (error) {
    console.error(`[processOwnerResponse] ❌ Error:`, error);
    return {
      success: false,
      message: `Error al procesar: ${String(error)}`,
    };
  }
}

/**
 * Agente de requests mejorado con flujo en dos pasos:
 * 1. Extrae el requestId del mensaje del dueño
 * 2. Obtiene todo el contexto (request, historial completo del cliente)
 * 3. Ejecuta el agente de procesamiento con contexto completo
 */
export async function runRequestsAgent(
  messages: ChatMessage[],
  businessName: string,
  ownerResponse: string,
): Promise<string> {
  console.log('[runRequestsAgent] Iniciando flujo de procesamiento...');
  console.log('[runRequestsAgent] Messages:', messages);

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    return "No se encontró un mensaje válido del usuario.";
  }

  // === PASO 1: Extraer el requestId buscando en todos los mensajes ===
  console.log('[runRequestsAgent] PASO 1: Extrayendo requestId de la lista de mensajes...');
  let requestId: string | null = null;

  // Buscar el Request ID en todos los mensajes, desde el más reciente al más antiguo
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const extractedId = extractRequestId(message.content);
    
    if (extractedId) {
      requestId = extractedId;
      console.log(`[runRequestsAgent] ✓ Request ID encontrado en mensaje ${i} (${message.role}): ${requestId}`);
      break;
    }
  }
  
  if (!requestId) {
    console.log('[runRequestsAgent] ❌ No se detectó Request ID en ningún mensaje');
    return "No se detectó un Request ID en la conversación. Por favor, incluye el Request ID en el formato 'Request ID: xxxxx'.";
  }

  console.log(`[runRequestsAgent] ✓ Request ID detectado: ${requestId}`);

  // === PASO 2: Obtener todo el contexto necesario ===
  console.log('[runRequestsAgent] PASO 2: Obteniendo contexto completo...');
  
  let requestData: any;
  let customerHistory: ChatMessage[] = [];
  
  try {
    // Obtener datos del request
    const requestDoc = await db.collection("agents/multimai/requests").doc(requestId).get();
    
    if (!requestDoc.exists) {
      console.error(`[runRequestsAgent] ❌ Request no encontrado: ${requestId}`);
      return `No se encontró la solicitud con ID: ${requestId}. Es posible que ya haya sido procesada o eliminada.`;
    }

    requestData = requestDoc.data();
    console.log('[runRequestsAgent] ✓ Request data obtenido:', requestData);

    if (!requestData.userId || !requestData.customer?.phone) {
      console.error('[runRequestsAgent] ❌ Datos incompletos en el request');
      return "Los datos de la solicitud están incompletos. No se puede procesar.";
    }

    // Obtener historial completo del cliente usando getHistory
    console.log('[runRequestsAgent] Obteniendo historial del cliente...');
    customerHistory = await getHistory(requestData.userId, requestData.customer.phone);
    console.log(`[runRequestsAgent] ✓ Historial obtenido: ${customerHistory.length} mensajes`);

  } catch (error) {
    console.error("[runRequestsAgent] ❌ Error obteniendo contexto:", error);
    return `Error al obtener el contexto de la solicitud: ${String(error)}`;
  }

  // === PASO 3: Ejecutar el agente de procesamiento con contexto completo ===
  console.log('[runRequestsAgent] PASO 3: Ejecutando agente de procesamiento...');
  
  const context = requestData.context || {};
  const requestContext = {
    question: context.question || context.property_name || "Consulta del cliente",
    recentMessages: context.recentMessages || [],
    customerName: requestData.customer.name || "Cliente",
    customerPhone: requestData.customer.phone,
    fullHistory: customerHistory,
  };

  console.log('[runRequestsAgent] Contexto preparado:', {
    question: requestContext.question,
    recentMessagesCount: requestContext.recentMessages.length,
    fullHistoryCount: requestContext.fullHistory.length,
  });

  const systemPrompt = PROCESS_RESPONSE_PROMPT(businessName, ownerResponse, requestContext);

  // Crear herramienta para procesar respuesta del dueño
  const processResponseTool = tool({
    description:
      "Procesa la respuesta del dueño a una solicitud del cliente. " +
      "Extrae la respuesta del dueño y el chat_message_id más relevante del historial. " +
      "El sistema guardará la respuesta y la enviará al cliente automáticamente.",
    inputSchema: z.object({
      requestId: z
        .string()
        .describe(
          "El ID de la solicitud que se está respondiendo.",
        ),
      ownerResponse: z
        .string()
        .describe(
          "La respuesta del dueño a la solicitud del cliente. " +
            "Debe ser clara, útil y estar lista para enviar al cliente.",
        ),
      replyToChatMessageId: z
        .string()
        .optional()
        .describe(
          "chat_message_id del mensaje de WhatsApp al que se debe responder. " +
            "Elige el mensaje más relevante del historial, priorizando los mensajes recientes de la solicitud. " +
            "Si no hay IDs disponibles, omite este parámetro.",
        ),
    }),
    execute: async ({ requestId, ownerResponse, replyToChatMessageId }: {
      requestId: string;
      ownerResponse: string;
      replyToChatMessageId?: string;
    }) => {
      console.log('[processResponseTool] Ejecutando con:', {
        requestId,
        ownerResponse: ownerResponse.substring(0, 50) + '...',
        replyToChatMessageId,
      });
      const result = await processOwnerResponse(requestId, ownerResponse, replyToChatMessageId);
      return JSON.stringify(result);
    },
  });

  const result = await generateText({
    model: getOpenRouterModel("openai/gpt-oss-120b"),
    system: systemPrompt,
    messages: [
      {
        role: 'assistant',
        content: `Let's reformulate the question: `
      },
      {
        role: 'user',
        content: lastMessage.content,
      }
    ],
    tools: {
      process_owner_response: processResponseTool,
    },
    stopWhen: stepCountIs(2), // Stop after 1 step (v5)
  });

  console.log('[runRequestsAgent] ✓ Procesamiento completado');
  return result.text;
}
