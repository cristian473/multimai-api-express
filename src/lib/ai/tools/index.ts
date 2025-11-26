import { tool } from "ai";
import { z } from "zod";
import {
  queryProperties,
  queryPropertiesRAG,
  formatSearchResults,
} from "@/lib/utils/search-properties";
import { getUserConfig } from "../../db/repositories/users";
import { saveConversationMessage, saveMultimaiMessage, getRecentUserMessages } from "@/lib/db/repositories/conversations";
import { db } from "../../db/firebase";
import { wsProxyClient } from "../../other/wsProxyClient";
import { propertyVisits } from "../../db/constants";
import { getPropertyById } from "../../db/repositories/properties";
import { retrievalRAG } from "../../db/repositories/rag";
import { generateObject } from "ai";
import { getModel, getOpenRouterModel } from "../../ai/openrouter";
import { AI_CONFIG } from "../../ai/config";
import { cacheFn, cacheSearchFn } from "../../cache";
import { Propiedad } from "../../db/types";

// Cache para resultados de búsqueda
const searchResultsCache = new Map<string, string>();

export function getSearchResultsCache() {
  return searchResultsCache;
}

// Generar un ID único para búsquedas
function generateSearchId() {
  return `SEARCH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Formatear propiedad como texto completo
function formatPropertyAsText(property: any) {
  const {
    nombre,
    descripcion,
    precio,
    precio_moneda,
    tipo_propiedad,
    tipo_operacion,
    ubicacion,
    ubicacion_url,
    ubicacion_simple,
    contrato,
    dormitorios,
    baños,
    requisitos,
    superficie,
    fotos,
    id,
    extra_fields,
  } = property;
  const operacion = tipo_operacion === "Alquiler" ? "por mes" : "";
  const superficieInfo =
    tipo_operacion === "Venta" ? `   - *Superficie:* ${superficie}` : "";
  const requisitosInfo =
    tipo_operacion === "Alquiler" ? `   - *Requisitos:* ${requisitos}` : "";

  const fotosText =
    fotos?.map((f: any) => `![${f.label}](${f.url})`).join("\n\n") ?? "";
  const extraFieldsInfo =
    extra_fields
      ?.map((field: any) => `   - *${field.name}*: ${field.value}`)
      .join("\n") ?? "";

  const address = ubicacion_simple || ubicacion;
  const addressUrl = ubicacion_url
    ? `   - *Link de ubicación:* ${ubicacion_url}`
    : "";

  let propertyText = "";

  if (fotosText) {
    propertyText += `${fotosText}\n\n`;
  }

  propertyText += `### ${tipo_propiedad} "${nombre}"\n`;
  propertyText += `${descripcion}\n\n`;
  propertyText += `*Detalles de la propiedad:*\n`;
  propertyText += `   - *Precio:* ${precio} ${precio_moneda} ${operacion}\n`;

  if (superficieInfo) {
    propertyText += `${superficieInfo}\n`;
  }

  propertyText += `   - *Ubicación:* ${address}\n`;

  if (addressUrl) {
    propertyText += `${addressUrl}\n`;
  }

  propertyText += `   - *Contrato:* ${contrato}\n`;
  propertyText += `   - *Dormitorios:* ${dormitorios}\n`;
  propertyText += `   - *Baños:* ${baños}\n`;

  if (requisitosInfo) {
    propertyText += `${requisitosInfo}\n`;
  }

  if (extraFieldsInfo) {
    propertyText += `${extraFieldsInfo}\n`;
  }

  propertyText += `@@property_id: ${property.id}@@\n`;

  return propertyText;
}

// Formatear resumen de propiedad
function formatPropertySummary(property: any) {
  const { nombre, descripcion, tipo_propiedad, dormitorios, fotos } = property;

  let summaryText = `*${tipo_propiedad} "${nombre}"* - ${descripcion}`;

  if (dormitorios) {
    summaryText += ` 🛏️ ${dormitorios} dormitorios`;
  }

  summaryText = summaryText.replace(/\n\n/g, "\n");

  const primeraFoto = fotos?.[0];
  let messageContent = "";
  
  if (primeraFoto) {
    // Use a simple alt text without line breaks for the image markdown
    const imageAltText = `${tipo_propiedad} ${nombre}`.replace(/\n/g, " ").trim();
    // Format: image first, then description text
    messageContent = `![${imageAltText}](${primeraFoto.url})\n\n${summaryText}`;
  } else {
    messageContent = summaryText;
  }

  messageContent += `@@property_id: ${property.id}@@`;

  return messageContent;
}

// Rerank properties using LLM (gpt-4o-mini) with batch processing and relevance scoring
async function rerankPropertiesWithLLM(
  properties: any[],
  userQuery: string,
  searchParams: any
): Promise<any[]> {
  try {
    console.log('[Rerank] Starting LLM-based reranking with', properties.length, 'properties');
    
    // If there are 3 or fewer properties, return all without reranking
    if (properties.length <= 3) {
      console.log('[Rerank] Skipping rerank - 3 or fewer properties');
      return properties;
    }

    const BATCH_SIZE = 10;
    const RELEVANCE_THRESHOLD = 0.7;
    const model = getModel(AI_CONFIG?.REANKING_MODEL ?? 'openai/gpt-4o-mini');
    
    // Check if location is specified for distance calculations
    const hasLocationParam = !!searchParams.ubicacion;
    
    // Store all property scores with location info
    interface PropertyScore {
      property: any;
      score: number;
      originalIndex: number;
      distanceInfo?: string;
      locationReasoning?: string;
    }
    const allScores: PropertyScore[] = [];

    // Process properties in batches of 10
    const batches = [];
    for (let i = 0; i < properties.length; i += BATCH_SIZE) {
      batches.push(properties.slice(i, i + BATCH_SIZE));
    }

    console.log(`[Rerank] Processing ${batches.length} batches of up to ${BATCH_SIZE} properties`);

    // Process each batch
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const batchOffset = batchIdx * BATCH_SIZE;
      
      console.log(`[Rerank] Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} properties)`);

      // Build context for batch
      const propertiesContext = batch.map((prop, idx) => ({
        index: idx,
        id: prop.id,
        nombre: prop.nombre,
        tipo_propiedad: prop.tipo_propiedad,
        tipo_operacion: prop.tipo_operacion,
        ubicacion: prop.ubicacion_simple || prop.ubicacion,
        precio: prop.precio,
        precio_moneda: prop.precio_moneda,
        dormitorios: prop.dormitorios,
        baños: prop.baños,
        descripcion: prop.descripcion?.substring(0, 200) || '', // Limit description length
        superficie: prop.superficie,
      }));

      try {
        const result = await generateObject({
          model,
          temperature: 0.3,
          schema: z.object({
            property_scores: z.array(
              z.object({
                index: z.number().describe('Index of the property in the batch (0-based)'),
                relevance_score: z.number().min(0).max(1).describe(
                  'Relevance score from 0 to 1. Values > 0.7 indicate high relevance. Consider all criteria: location, type, price, features.'
                ),
                reasoning: z.string().describe('Brief explanation for the score'),
                distance_info: hasLocationParam 
                  ? z.string().optional().describe('If location parameter is specified, provide approximate distance or proximity info (e.g., "In same neighborhood", "2-3 blocks away", "Nearby area", "Different zone but close"). Leave empty if exact same location.')
                  : z.string().optional(),
              })
            ).describe('Score for each property in the batch'),
          }),
          prompt: `You are a real estate assistant scoring property relevance for search results.

USER QUERY: "${userQuery}"

SEARCH PARAMETERS:
${JSON.stringify(searchParams, null, 2)}

PROPERTIES IN THIS BATCH (${batch.length} properties):
${JSON.stringify(propertiesContext, null, 2)}

TASK:
Score each property's relevance from 0 to 1 based on how well it matches the user's query and criteria.

${hasLocationParam ? `
IMPORTANT - LOCATION ANALYSIS:
Since the user specified location "${searchParams.ubicacion}", you MUST:
1. Analyze each property's location relative to the requested location
2. Provide distance_info for properties not in the exact location (e.g., "2-3 blocks away", "Nearby area", "Same zone")
3. Leave distance_info empty ONLY if the property is in the EXACT requested location
4. Consider proximity in your relevance_score - nearby properties should still score well (0.6-0.8)
` : ''}

SCORING GUIDE:
- 0.9-1.0: Perfect match - meets all or almost all criteria
- 0.7-0.89: Good match - meets most important criteria
- 0.5-0.69: Partial match - meets some criteria but missing key aspects
- 0.3-0.49: Weak match - few criteria met
- 0.0-0.29: Poor match - doesn't match user needs

EVALUATION CRITERIA (in order of importance):
1. Operation type match (rent/sale) - CRITICAL
2. Location match (exact or nearby) ${hasLocationParam ? '- PROVIDE DISTANCE INFO' : ''}
3. Property type match
4. Price range fit
5. Number of bedrooms/ambientes
6. Additional features and amenities

You MUST provide a score for EVERY property in the batch (${batch.length} properties).
Return scores in the same order as the properties.`,
        });

        // Add scores from this batch
        result.object.property_scores.forEach((scoreData) => {
          if (scoreData.index >= 0 && scoreData.index < batch.length) {
            const property = batch[scoreData.index];
            
            // Add distance info to property if available
            if (scoreData.distance_info && hasLocationParam) {
              property._distanceInfo = scoreData.distance_info;
            }
            
            allScores.push({
              property,
              score: scoreData.relevance_score,
              originalIndex: batchOffset + scoreData.index,
              distanceInfo: scoreData.distance_info,
              locationReasoning: scoreData.reasoning
            });
            
            if (scoreData.relevance_score > RELEVANCE_THRESHOLD) {
              const locationNote = scoreData.distance_info ? ` [${scoreData.distance_info}]` : '';
              console.log(
                `[Rerank] Property #${batchOffset + scoreData.index} "${property.nombre}"${locationNote} scored ${scoreData.relevance_score.toFixed(2)} - ${scoreData.reasoning}`
              );
            }
          }
        });
      } catch (batchError) {
        console.error(`[Rerank] Error processing batch ${batchIdx + 1}:`, batchError);
        // Add batch properties with default low score as fallback
        batch.forEach((prop, idx) => {
          allScores.push({
            property: prop,
            score: 0.5,
            originalIndex: batchOffset + idx,
          });
        });
      }
    }

    // Filter properties with score > 0.7 and sort by score descending
    const relevantProperties = allScores
      .filter(item => item.score > RELEVANCE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .map(item => item.property);

    console.log(`[Rerank] Found ${relevantProperties.length} properties above threshold (${RELEVANCE_THRESHOLD})`);
    console.log('[Rerank] Top scores:', allScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(s => ({ 
        nombre: s.property.nombre, 
        score: s.score.toFixed(2),
        distanceInfo: s.distanceInfo || 'exact location'
      }))
    );

    // Return top 10 most relevant properties
    return relevantProperties.slice(0, 10);
  } catch (error) {
    console.error('[Rerank] Error in LLM reranking:', error);
    // Fallback: return top 5 properties by original score
    return properties.slice(0, 5);
  }
}

/**
 * Internal function for RAG search with reranking
 * Separated to allow flexible caching
 */
async function executeRAGSearchInternal(
  uid: string,
  userPhone: string,
  params: any
): Promise<any> {
  console.log('[Hybrid RAG Tool] Starting hybrid RAG property search');
  const searchResult = await queryPropertiesRAG(uid, params as any);
  const { propertiesToShow, message } = formatSearchResults(searchResult);

  if (propertiesToShow.length === 0) {
    await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: search_properties_rag - no properties found`, undefined, true);
    return {
      searchId: null,
      count: 0,
      hasMore: false,
      contextMessage: searchResult.additionalText || 'No encontré propiedades con esos criterios.',
      onlyMessage: true,
      formattedProperties: '',
    };
  }

  // Build user query from parameters for reranking
  const userQueryParts: string[] = [];
  if (params.tipo_operacion) userQueryParts.push(`${params.tipo_operacion}`);
  if (params.tipo_propiedad) userQueryParts.push(`${params.tipo_propiedad}`);
  if (params.ubicacion) userQueryParts.push(`en ${params.ubicacion}`);
  if (params.precio) userQueryParts.push(`precio ${params.precio.join(' a ')}`);
  if (params.ambientes) userQueryParts.push(`${params.ambientes} ambientes`);
  if (params.otro) userQueryParts.push(params.otro);
  const userQuery = userQueryParts.join(', ');

  // Rerank properties with LLM
  console.log('[Hybrid RAG Tool] Reranking', propertiesToShow.length, 'properties with LLM');
  const rerankedProperties = await rerankPropertiesWithLLM(
    propertiesToShow,
    userQuery,
    params
  );

  console.log('[Hybrid RAG Tool] After rerank:', rerankedProperties.length, 'properties');

  // Handle case when no properties are relevant after reranking
  if (rerankedProperties.length === 0) {
    await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: search_properties_rag - no relevant properties after rerank`, undefined, true);
    return {
      searchId: null,
      count: 0,
      hasMore: false,
      contextMessage: 'No encontré propiedades que coincidan exactamente con tu búsqueda. ¿Quieres que ajuste los criterios?',
      onlyMessage: true,
      formattedProperties: '',
    };
  }

  // Format all reranked properties: return full details if only one, summaries otherwise
  const formattedSummaries = rerankedProperties.length === 1
    ? formatPropertyAsText(rerankedProperties[0])
    : rerankedProperties.map((property) => formatPropertySummary(property)).join("\n\n");

  console.log(formattedSummaries);

  const searchId = generateSearchId();

  // Cache results in local cache too
  searchResultsCache.set(searchId, formattedSummaries);

  await saveConversationMessage(
    uid,
    userPhone,
    'assistant',
    `tool executed: search_properties_rag - ${rerankedProperties.length} relevant properties found after LLM rerank`,
    undefined,
    true
  );

  return {
    searchId,
    count: rerankedProperties.length,
    hasMore: false, // After reranking, we show only the most relevant
    contextMessage: `Encontré ${rerankedProperties.length} ${rerankedProperties.length === 1 ? 'propiedad relevante' : 'propiedades relevantes'} para tu búsqueda.`,
    onlyMessage: false,
    formattedProperties: formattedSummaries,
    searchType: 'hybrid_rag_with_rerank',
  };
}

// Tool: search_properties_rag (HYBRID - Semantic + Proximity + Criteria)
export const searchPropertiesRAGTool = (uid: string, userPhone: string) =>
  tool({
    description:
      "Ejecuta una búsqueda HÍBRIDA de propiedades que combina búsqueda semántica (RAG), proximidad geográfica y coincidencia de criterios. Sistema inteligente que prioriza propiedades con coincidencia textual de ubicación y también sugiere opciones cercanas. Scoring: 50% similitud semántica + 30% proximidad + 20% criterios. Filtro obligatorio por tipo_operacion.",
    inputSchema: z.object({
      tipo_operacion: z
        .string()
        .optional()
        .nullable()
        .describe("Tipo de operación: Compra, Venta o Alquiler (filtro obligatorio)"),
      tipo_propiedad: z
        .string()
        .optional()
        .nullable()
        .describe("Tipo de propiedad: Casa, Departamento, Terreno"),
      ubicacion: z
        .string()
        .optional()
        .nullable()
        .describe("Ubicación deseada (barrio, ciudad, zona) - prioriza coincidencia textual y calcula proximidad"),
      precio: z
        .array(z.string())
        .optional()
        .nullable()
        .describe("Rango de precio [min, max] o precio único"),
      ambientes: z
        .number()
        .optional()
        .nullable()
        .describe("Número de ambientes o dormitorios"),
      otro: z
        .string()
        .optional()
        .nullable()
        .describe("Cualquier otra característica o descripción en lenguaje natural"),
    }),
    execute: async (params) => {
      try {
        // Generate tags based on search parameters
        const tags: string[] = ['properties', 'rag-search-tool', `user:${uid}`];

        if (params.tipo_operacion) {
          tags.push(`tipo_operacion:${params.tipo_operacion.toLowerCase()}`);
        }
        if (params.ubicacion) {
          tags.push(`ubicacion:${params.ubicacion.toLowerCase()}`);
        }
        if (params.tipo_propiedad) {
          tags.push(`tipo_propiedad:${params.tipo_propiedad.toLowerCase()}`);
        }
        if (params.ambientes) {
          tags.push(`ambientes:${params.ambientes}`);
        }

        // Use flexible cache for search with similar parameter matching
        const result = await cacheSearchFn(
          executeRAGSearchInternal,
          [uid, userPhone, params],
          {
            functionName: 'searchPropertiesRAGTool',
            ttl: 1800, // 30 minutes
            tags,
            prefix: 'tool-rag',
            fuzzyMatch: true, // Enable fuzzy matching
            similarityThreshold: 0.85, // 85% similarity for cache hit
            paramsExtractor: (args) => args[2], // Extract params (third argument)
          }
        );

        return result.formattedProperties ?? 'No se encontraron propiedades';
      } catch (error) {
        console.error('[Hybrid RAG Tool] Error in hybrid RAG search, falling back to traditional:', error);

        // Fallback to traditional search
        const searchResult = await queryProperties(uid, params as any);
        const { propertiesToShow, message } = formatSearchResults(searchResult);

        if (propertiesToShow.length === 0) {
          return JSON.stringify({
            searchId: null,
            count: 0,
            hasMore: false,
            contextMessage: 'No encontré propiedades con esos criterios.',
            onlyMessage: true,
            formattedProperties: '',
          });
        }

        const propertiesText = propertiesToShow
          .map((property: Propiedad) => formatPropertyAsText(property))
          .join("\n\n---\n\n");

        const searchId = generateSearchId();
        searchResultsCache.set(searchId, propertiesText);

        return JSON.stringify({
          searchId,
          count: propertiesToShow.length,
          hasMore: searchResult.totalResults > propertiesToShow.length,
          contextMessage: message,
          onlyMessage: false,
          formattedProperties: propertiesText,
          searchType: 'traditional_fallback',
        });
      }
    },
  });

// Tool: get_property_info - Enhanced to support ID or Name-based search
export const getPropertyInfoTool = (uid: string) =>
  tool({
    description:
      "Obtiene información detallada de UNA propiedad específica. Puede buscar por ID (extraído de @@property_id: XXX@@) o por nombre de la propiedad usando búsqueda semántica RAG. Para búsquedas generales usar search_properties.",
    inputSchema: z.object({
      id: z.string().optional().describe("ID único de la propiedad (extraído del formato @@property_id: XXX@@ en el historial de conversación)"),
      nombre: z.string().optional().describe("Nombre de la propiedad para buscar usando búsqueda semántica (usar cuando el usuario mencione el nombre pero no se tenga el ID)"),
    }),
    execute: async ({ id, nombre }) => {
      console.log("[getPropertyInfoTool] Getting property info - ID:", id, "Nombre:", nombre);

      // Validate that at least one parameter is provided
      if (!id && !nombre) {
        return JSON.stringify({
          success: false,
          message: "Necesito el ID o nombre de la propiedad para buscarla.",
          property: null,
        });
      }

      // Use cache for property details
      const cachedResult = await cacheFn(
        async (uid: string, propertyId?: string, propertyName?: string) => {
          let property = null;

          // If ID is provided, search by ID (faster, exact match)
          if (propertyId) {
            console.log("[getPropertyInfoTool] Searching by ID:", propertyId);
            property = await getPropertyById(uid, propertyId);
          }
          
          // If no property found by ID (or no ID provided), try searching by name using RAG
          if (!property && propertyName) {
            console.log("[getPropertyInfoTool] Searching by name using RAG:", propertyName);
            
            try {
              // Perform RAG search with the property name
              const keys = ['properties', uid];
              const ragResults = await retrievalRAG(keys, propertyName, 5); // Get top 5 results
              
              console.log(`[getPropertyInfoTool] RAG search returned ${ragResults.length} results`);
              
              if (ragResults.length > 0) {
                // Get the best match (highest similarity)
                const bestMatch = ragResults[0];
                const propertyIdFromRAG = bestMatch.metadata?.id;
                
                if (propertyIdFromRAG) {
                  console.log(`[getPropertyInfoTool] Best match: ${propertyIdFromRAG} (similarity: ${bestMatch.similarity})`);
                  property = await getPropertyById(uid, propertyIdFromRAG);
                  
                  // If similarity is low, add a note
                  if (property && bestMatch.similarity < 0.7) {
                    console.log(`[getPropertyInfoTool] Low similarity (${bestMatch.similarity}), might not be exact match`);
                  }
                }
              }
            } catch (ragError) {
              console.error("[getPropertyInfoTool] Error in RAG search:", ragError);
              // Continue to return not found message
            }
          }

          if (!property) {
            return {
              success: false,
              message: propertyName 
                ? `No encontré una propiedad llamada "${propertyName}". ¿Querés que busque con otros criterios?`
                : "No encontré esa propiedad. ¿Querés que busque alternativas?",
              property: null,
            };
          }

          // Format the complete property
          const propertyText = formatPropertyAsText(property);
          const searchId = generateSearchId();

          // Save to local cache as well
          searchResultsCache.set(searchId, propertyText);

          return {
            success: true,
            searchId,
            property: {
              id: property.id,
              nombre: property.nombre,
              tipo: property.tipo_propiedad,
            },
            formattedProperty: propertyText,
            searchMethod: propertyId ? 'id' : 'name_rag',
          };
        },
        [uid, id, nombre],
        {
          functionName: 'getPropertyInfo',
          ttl: 3600, // 1 hour - property details don't change frequently
          tags: [
            'properties',
            'property-details',
            `user:${uid}`,
            id ? `property:${id}` : `property-name:${nombre}`
          ],
          prefix: 'tool'
        }
      );

      return JSON.stringify(cachedResult);
    },
  });

// Tool: get_today_date
export const getTodayDateTool = () =>
  tool({
    description:
      "Obtiene la fecha actual. Útil para calcular fechas relativas cuando el cliente menciona días como 'el viernes', 'mañana', 'el próximo martes', etc.",
    inputSchema: z.object({}),
    execute: async () => {
      const today = new Date();
      const dateStr = today.toLocaleDateString("es-AR", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const isoDate = today.toISOString().split("T")[0];

      // await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: get_today_date - today date: ${isoDate}`);
      
      return JSON.stringify({
        date: isoDate,
        formatted: dateStr,
        message: `Hoy es ${dateStr} (${isoDate})`,
      });
    },
  });

// Tool: get_help
export const getHelpTool = (uid: string, userPhone: string, userName: string) =>
  tool({
    description:
      "Solicita ayuda de un agente humano para una pregunta compleja. El dueño responderá posteriormente y el cliente será notificado.",
    inputSchema: z.object({
      question: z
        .string()
        .describe("La pregunta o consulta que necesita ayuda humana"),
    }),
    execute: async ({ question }) => {
      try {
        const userConfig = await getUserConfig(uid);

        if (!userConfig) {
          return JSON.stringify({
            success: false,
            message: "Ok esperame, ya lo consulto y te digo",
          });
        }

        const reportsNumber = userConfig.config.reportsNumber;
        const multimaiSession = process.env.MULTIMAI_WS_SESSION;

        console.log("[getHelpTool] Iniciando solicitud de ayuda humana");
        console.log("[getHelpTool] Pregunta:", question);
        console.log("[getHelpTool] Cliente:", userName, userPhone);

        // Obtener los últimos 10 mensajes del usuario con sus IDs
        const recentMessages = await getRecentUserMessages(uid, userPhone, 10);
        console.log("[getHelpTool] Últimos mensajes del usuario:", recentMessages.length);

        // Crear el request en Firebase con los mensajes del contexto
        // Filtrar undefined para evitar errores de Firebase
        const requestData = {
          request: `Solicitud de ayuda: ${question}`,
          userId: uid,
          customer: {
            name: userName,
            phone: userPhone,
          },
          context: {
            question: question,
            recentMessages: recentMessages.map(msg => {
              const msgData: { content: string; chat_message_id?: string } = {
                content: msg.content,
              };
              // Solo agregar chat_message_id si existe
              if (msg.chat_message_id) {
                msgData.chat_message_id = msg.chat_message_id;
              }
              return msgData;
            }),
          },
          workflowStatus: "pending",
          timestamp: new Date(),
        };

        const requestRef = await db
          .collection("agents/multimai/requests")
          .add(requestData);
        const requestId = requestRef.id;

        console.log("[getHelpTool] Request creado:", requestId);

        // Enviar mensaje al dueño por WhatsApp
        const messageToOwner = `Hola!, el número ${userPhone} (${userName}) necesita ayuda con la pregunta:\n\n*${question}*\n\n_Request ID: ${requestId}_`;

        await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: get_help - message to owner: ${messageToOwner}`, undefined, true);

        await wsProxyClient.post(`/ws/send-message`, {
          chatId: reportsNumber,
          session: multimaiSession,
          messages: [
            {
              type: "text",
              payload: {
                content: messageToOwner,
              },
            },
          ],
        });

        await saveMultimaiMessage(userPhone, 'assistant', messageToOwner);

        console.log(
          "[getHelpTool] ✅ Mensaje enviado al dueño. Request ID:",
          requestId,
        );

        // NO iniciar workflow - la respuesta llegará después
        // Retornar inmediatamente para que el bot pueda continuar
        return JSON.stringify({
          success: true,
          requestId: requestId,
          message: "Ok, le consulto al dueño y te aviso en cuanto me responda. ¿Hay algo más en lo que pueda ayudarte mientras tanto?",
        });
      } catch (error) {
        console.error("[getHelpTool] ❌ Error:", error);
        return JSON.stringify({
          success: false,
          message:
            "Hubo un error procesando la solicitud. Por favor intenta de nuevo.",
          error: String(error),
        });
      }
    },
  });

const getVisitsCollection = (uid: string) => db.collection(propertyVisits(uid));

// Helper function: Create visit reminders (1 hour before and 1 day before)
async function createVisitReminders(
  uid: string,
  userPhone: string,
  userName: string,
  visitId: string,
  visitDate: Date,
  visitTime: string,
  propertyInfo: any
) {
  try {
    const [hours, minutes] = visitTime.split(":");
    const visitDateTime = new Date(visitDate);
    visitDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

    // Reminder 1 hour before
    const oneHourBefore = new Date(visitDateTime.getTime() - 60 * 60 * 1000);

    // Reminder 1 day before
    const oneDayBefore = new Date(visitDateTime.getTime() - 24 * 60 * 60 * 1000);

    const reminderMessages = [
      {
        dateTime: oneHourBefore,
        message: `Recordatorio: Tienes una visita programada a la propiedad "${propertyInfo.nombre}" en 1 hora (${visitTime}). ¿Necesitas alguna información adicional?`,
      },
      {
        dateTime: oneDayBefore,
        message: `Recordatorio: Mañana tienes una visita programada a la propiedad "${propertyInfo.nombre}" a las ${visitTime}. ¿Necesitas confirmar o reagendar?`,
      },
    ];

    const createdReminders = [];

    for (const reminder of reminderMessages) {
      // Skip if reminder time is in the past
      if (reminder.dateTime < new Date()) {
        console.log(`[createVisitReminders] Skipping past reminder for ${reminder.dateTime.toISOString()}`);
        continue;
      }

      const reminderData = {
        userId: uid,
        customer: {
          name: userName,
          phone: userPhone,
        },
        context: {
          metadata: {
            visit_id: visitId,
            property_id: propertyInfo.id,
            property_name: propertyInfo.nombre,
            visit_date: visitDate.toISOString(),
            visit_time: visitTime,
          },
        },
        timestamp: new Date(),
        eventDateTime: reminder.dateTime,
        toRemember: reminder.message,
        type: 'visit_reminder',
      };

      const reminderRef = await db
        .collection(`users/${uid}/reminders`)
        .add(reminderData);

      createdReminders.push({
        id: reminderRef.id,
        dateTime: reminder.dateTime,
      });

      console.log(`[createVisitReminders] Created reminder ${reminderRef.id} for ${reminder.dateTime.toLocaleString("es-AR")}`);
    }

    return createdReminders;
  } catch (error) {
    console.error("[createVisitReminders] Error creating reminders:", error);
    throw error;
  }
}

// Helper function: Delete visit reminders for a specific user and visit
async function deleteVisitReminders(
  uid: string,
  userPhone: string,
  visitId: string
) {
  try {
    console.log(`[deleteVisitReminders] Deleting reminders for visit ${visitId} and user ${userPhone}`);

    // Find all reminders for this visit and user
    const remindersSnapshot = await db
      .collection(`users/${uid}/reminders`)
      .where("customer.phone", "==", userPhone)
      .where("type", "==", "visit_reminder")
      .get();

    const deletedReminders = [];

    for (const doc of remindersSnapshot.docs) {
      const data = doc.data();
      const metadata = data.context?.metadata;

      // Check if this reminder is for the specific visit
      if (metadata?.visit_id === visitId) {
        await doc.ref.delete();
        deletedReminders.push(doc.id);
        console.log(`[deleteVisitReminders] Deleted reminder ${doc.id}`);
      }
    }

    console.log(`[deleteVisitReminders] Deleted ${deletedReminders.length} reminders`);
    return deletedReminders;
  } catch (error) {
    console.error("[deleteVisitReminders] Error deleting reminders:", error);
    throw error;
  }
}

// Tool: get_availability_to_visit_the_property
export const getAvailabilityToVisitPropertyTool = (uid: string, userPhone: string) =>
  tool({
    description:
      "Obtiene la disponibilidad de visitas programadas para una propiedad específica",
    inputSchema: z.object({
      property_id: z.string().describe("ID de la propiedad"),
    }),
    execute: async ({ property_id }) => {
      try {
        console.log("[getAvailabilityToVisitPropertyTool] Iniciando consulta de disponibilidad");
        console.log("[getAvailabilityToVisitPropertyTool] Propiedad:", property_id);

        // Validate property_id pattern: 20 alphanumeric chars (like "2Vtmo4w4O1u2L70u2KVA")
        const validPropertyIdPattern = /^[A-Za-z0-9]{20}$/;
        if (!validPropertyIdPattern.test(property_id)) {
          return JSON.stringify({
            success: false,
            message: "property_id no es un pattern válido, consultar al usuario sobre el ID de la propiedad o si tiene otro dato que pueda identificar la propiedad",
          });
        }

        // Use cache for visit availability
        const cachedResult = await cacheFn(
          async (uid: string, propertyId: string, userPhone: string) => {
            const visitsSnapshot = await getVisitsCollection(uid)
              .where("propertyId", "==", propertyId)
              .where("status", "==", "programada")
              .get();

            if (visitsSnapshot.empty) {
              console.log("[getAvailabilityToVisitPropertyTool] No hay visitas programadas");
              return {
                success: true,
                visits: [],
                message: "No hay visitas programadas, PRIMERO consultar día y hora de disponibilidad del usuario, LUEGO utilizar ask_for_availability para consultar al dueño",
              };
            }

            console.log("[getAvailabilityToVisitPropertyTool] Visitas encontradas:", visitsSnapshot.docs.length);
            const visits = visitsSnapshot.docs.map((doc) => ({
              ...doc.data(),
              id: doc.id,
            }));

            // Filtrar visitas futuras
            const now = new Date();
            const futureVisits = visits.filter((visit: any) => {
              const visitDate = visit.date.toDate();
              const [hours, minutes] = visit.startTime.split(":");
              const visitDateTime = new Date(visitDate);
              visitDateTime.setHours(parseInt(hours), parseInt(minutes));
              return visitDateTime >= now;
            });

            await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: get_availability_to_visit_the_property - future visits: ${JSON.stringify(futureVisits)}`, undefined, true);
            console.log("[getAvailabilityToVisitPropertyTool] Future visits:", futureVisits);

            return {
              success: true,
              visits: futureVisits.map((v: any) => {
                const date = v.date.toDate();
                const dateStr = date.toLocaleDateString("es-AR", {
                  weekday: "long",
                  day: "2-digit",
                  month: "2-digit",
                });
                return {
                  property_visit_id: v.id,
                  visit_date: `El día ${dateStr}\n Empieza a las ${v.startTime} y finaliza a las ${v.endTime}`,
                  note: v.notes || undefined,
                };
              }),
            };
          },
          [uid, property_id, userPhone],
          {
            functionName: 'getAvailabilityToVisitProperty',
            ttl: 300, // 5 minutes - visits can change frequently
            tags: [
              'visits',
              'availability',
              `user:${uid}`,
              `property:${property_id}`
            ],
            prefix: 'tool'
          }
        );

        return JSON.stringify(cachedResult);
      } catch (error) {
        console.error("Error fetching visits:", error);
        return JSON.stringify({
          success: false,
          error: `Error al obtener visitas: ${String(error)}`,
        });
      }
    },
  });

// Tool: create_new_property_visit
export const createNewPropertyVisitTool = (
  uid: string,
  userPhone: string,
  userName: string,
) =>
  tool({
    description: "CREA una nueva visita a una propiedad. Usa esta tool cuando el cliente confirme un horario y quieras crear un nuevo documento de visita. Esta tool crea una nueva visita con el cliente como primer interesado.",
    inputSchema: z.object({
      property_id: z.string().describe("ID de la propiedad (REQUERIDO)"),
      date: z.string().describe("Fecha de la visita en formato YYYY-MM-DD (REQUERIDO)"),
      start_time: z.string().describe("Hora de inicio en formato HH:MM (REQUERIDO)"),
    }),
    execute: async ({ property_id, date, start_time }) => {
      try {
        console.log("[createNewPropertyVisitTool] Creating new property visit");
        console.log("[createNewPropertyVisitTool] Property ID:", property_id);
        console.log("[createNewPropertyVisitTool] Date:", date);
        console.log("[createNewPropertyVisitTool] Start time:", start_time);

        const property = await getPropertyById(uid, property_id);
        if (!property) {
          return JSON.stringify({
            success: false,
            error: "No se encontró la propiedad",
          });
        }

        await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: create_new_property_visit with parameters: ${JSON.stringify({ property_id, date, start_time })}`, undefined, true);
        const visitDate = new Date(date);
        
        // Check if user is already scheduled for a visit to this property on this date
        const existingVisitsSnapshot = await getVisitsCollection(uid)
          .where('propertyId', '==', property_id)
          .where('status', '==', 'programada')
          .get();
        
        for (const doc of existingVisitsSnapshot.docs) {
          const visitData = doc.data();
          const existingDate = visitData.date?.toDate?.() || visitData.date;
          
          // Check if it's the same date
          if (existingDate && 
              existingDate.toDateString() === visitDate.toDateString()) {
            // Check if user is already in this visit
            const visitors = visitData.visitors || [];
            const alreadyRegistered = visitors.some(
              (v: any) => v.clientPhone === userPhone
            );
            
            if (alreadyRegistered) {
              console.log("[createNewPropertyVisitTool] User already scheduled for this property visit");
              return JSON.stringify({
                success: true,
                already_scheduled: true,
                visit_id: doc.id,
                message: "Ya estás agendado para una visita a esta propiedad en esta fecha",
                visit_date: date,
                visit_time: visitData.startTime,
              });
            }
          }
        }
        
        // Calculate end_time by adding 1 hour to start_time
        const [hours, minutes] = start_time.split(":");
        const endHour = (parseInt(hours) + 1).toString().padStart(2, "0");
        const end_time = `${endHour}:${minutes}`;
        
        console.log("[createNewPropertyVisitTool] Visit date:", visitDate);
        console.log("[createNewPropertyVisitTool] Start time:", start_time);
        console.log("[createNewPropertyVisitTool] End time:", end_time);
        
        // Create new visit
        const newVisit = {
          propertyId: property_id,
          property: property,
          date: visitDate,
          startTime: start_time,
          endTime: end_time,
          status: "programada",
          currentInterested: 1,
          maxInterested: 5,
          visitors: [
            {
              clientName: userName,
              clientPhone: userPhone,
              createdAt: new Date(),
              status: "confirmado",
            },
          ],
          createdAt: new Date(),
          createdBy: "agent",
        };

        console.log("[createNewPropertyVisitTool] New visit:", newVisit);
        const visitRef = await getVisitsCollection(uid).add(newVisit);

        // Create reminders for the visit (1 hour before and 1 day before)
        try {
          await createVisitReminders(
            uid,
            userPhone,
            userName,
            visitRef.id,
            visitDate,
            start_time,
            property
          );
          console.log("[createNewPropertyVisitTool] Visit reminders created successfully");
        } catch (reminderError) {
          console.error("[createNewPropertyVisitTool] Error creating reminders:", reminderError);
          // Don't fail the visit creation if reminders fail
        }

        await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: create_new_property_visit - visit created: ${visitRef.id}`, undefined, true);

        return JSON.stringify({
          success: true,
          visit_id: visitRef.id,
          message: "Visita creada y confirmada exitosamente",
        });
      } catch (error) {
        console.error("[createNewPropertyVisitTool] Error:", error);
        return JSON.stringify({
          success: false,
          error: `Error al crear la visita: ${String(error)}`,
        });
      }
    },
  });

// Tool: add_visitor_to_scheduled_visit
export const addVisitorToScheduledVisitTool = (
  uid: string,
  userPhone: string,
  userName: string,
) =>
  tool({
    description: "AGREGA un cliente interesado a una visita programada existente. Usa esta tool cuando quieras añadir un visitante a una visita que ya está creada. Incrementa el contador de interesados y agrega el cliente al array de visitors.",
    inputSchema: z.object({
      property_visit_id: z.string().describe("ID de la visita programada existente (REQUERIDO)"),
    }),
    execute: async ({ property_visit_id }) => {
      try {
        await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: add_visitor_to_scheduled_visit with parameters: ${JSON.stringify({ property_visit_id })}`, undefined, true);
          const visitRef = getVisitsCollection(uid).doc(property_visit_id);
          const visitDoc = await visitRef.get();

        console.log("[addVisitorToScheduledVisitTool] Visit doc:", visitDoc.data());

          if (!visitDoc.exists) {
            return JSON.stringify({
              success: false,
              error: "La visita programada no existe",
            });
          }

          const visitData = visitDoc.data();
          if (!visitData) {
            return JSON.stringify({
              success: false,
              error: "No se pudo obtener la información de la visita",
            });
          }

          if (visitData.currentInterested >= visitData.maxInterested) {
            return JSON.stringify({
              success: false,
              error: "La visita ha alcanzado el cupo máximo",
            });
          }

        // Check if client is already registered
        const visitors = visitData.visitors || [];
        const alreadyRegistered = visitors.some(
          (v: any) => v.clientPhone === userPhone,
        );

        if (alreadyRegistered) {
          await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: add_visitor_to_scheduled_visit - client already registered`, undefined, true);
          return JSON.stringify({
            success: true,
            already_scheduled: true,
            visit_id: property_visit_id,
            message: "Ya estás agendado para esta visita",
            visit_date: visitData.date?.toDate?.()?.toISOString?.()?.split('T')[0] || null,
            visit_time: visitData.startTime,
            nota: visitData.notes ?? undefined,
          });
        }

          const visitorData = {
            clientName: userName,
            clientPhone: userPhone,
            createdAt: new Date(),
            status: "confirmado",
          };

        console.log("[addVisitorToScheduledVisitTool] Visitor data:", visitorData);

          await db.runTransaction(async (transaction) => {
            const visitDoc = await transaction.get(visitRef);
            const visitData = visitDoc.data();
            const visitors = visitData?.visitors || [];
            visitors.push(visitorData);

          console.log("[addVisitorToScheduledVisitTool] Visitors:", visitors);

            transaction.update(visitRef, {
              currentInterested: (visitData?.currentInterested || 0) + 1,
              visitors: visitors,
            });
          });

        // Create reminders for the new visitor (1 hour before and 1 day before)
        try {
          await createVisitReminders(
            uid,
            userPhone,
            userName,
            property_visit_id,
            visitData.date.toDate(),
            visitData.startTime,
            visitData.property
          );
          console.log("[addVisitorToScheduledVisitTool] Visit reminders created successfully");
        } catch (reminderError) {
          console.error("[addVisitorToScheduledVisitTool] Error creating reminders:", reminderError);
          // Don't fail the visit addition if reminders fail
        }

        console.log("[addVisitorToScheduledVisitTool] Visit updated successfully");
        await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: add_visitor_to_scheduled_visit - visit ${property_visit_id} updated successfully with date ${visitData.date} and start time ${visitData.start_time} and ${visitors.length} visitors`, undefined, true);

          return JSON.stringify({
            success: true,
            nota: visitData.notes ?? undefined,
          message: "Te agregamos exitosamente a la visita",
        });
      } catch (error) {
        console.error("[addVisitorToScheduledVisitTool] Error:", error);
              return JSON.stringify({
                success: false,
          error: `Error al agregar visitante: ${String(error)}`,
        });
      }
    },
  });

// Tool: schedule_property_visit (DEPRECATED - Use create_new_property_visit or add_visitor_to_scheduled_visit instead)
// Kept for backwards compatibility
export const schedulePropertyVisitTool = (
  uid: string,
  userPhone: string,
  userName: string,
) =>
  tool({
    description: "DEPRECATED: Use create_new_property_visit or add_visitor_to_scheduled_visit instead. CONFIRMA Y AGENDA una visita a una propiedad. SIEMPRE debes llamar a esta tool cuando el cliente confirme un horario. Hay dos formas de usar esta tool: 1) Con property_visit_id si es una visita programada existente, 2) Con property_id + date + start_time para crear una nueva visita.",
    inputSchema: z.object({
      property_visit_id: z.string().optional().describe("ID de la visita programada (SOLO para confirmar visitas existentes). Si usas esto, NO envíes los otros parámetros."),
      property_id: z.string().optional().describe("ID de la propiedad (SOLO para crear nueva visita). Requerido si NO usas property_visit_id."),
      date: z.string().optional().describe("Fecha de la visita en formato YYYY-MM-DD (SOLO para crear nueva visita). Requerido si NO usas property_visit_id."),
      start_time: z.string().optional().describe("Hora de inicio en formato HH:MM (SOLO para crear nueva visita). Requerido si NO usas property_visit_id."),
    }),
    execute: async ({ property_visit_id, property_id, date, start_time }) => {
      // Redirect to the appropriate new tool
      if (property_visit_id) {
        return addVisitorToScheduledVisitTool(uid, userPhone, userName).execute!(
          { property_visit_id },
          { toolCallId: "", messages: [] }
        );
      }
      
      if (property_id && date && start_time) {
        return createNewPropertyVisitTool(uid, userPhone, userName).execute!(
          { property_id, date, start_time },
          { toolCallId: "", messages: [] }
        );
        }

        return JSON.stringify({
          success: false,
          error: "Debes proporcionar property_visit_id O (property_id + date + start_time)",
        });
    },
  });

// Tool: ask_for_availability (para el agente de visit-scheduling)
export const askForAvailabilityTool = (
  uid: string,
  userPhone: string,
  userName: string,
) =>
  tool({
    description:
      "Consulta al dueño sobre la disponibilidad para visitar una propiedad. El dueño responderá posteriormente y el cliente será notificado.",
    inputSchema: z.object({
      property_id: z.string().describe("ID de la propiedad a visitar"),
      suggested_days: z
        .string()
        .default("")
        .describe("Días sugeridos por el cliente (opcional, dejar vacío si no especifica)"),
      suggested_times: z
        .string()
        .default("")
        .describe("Horarios sugeridos por el cliente (opcional, dejar vacío si no especifica)"),
    }),
    execute: async (params) => {
      try {
        // await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: ask_for_availability with parameters: ${JSON.stringify(params)}`);
        const { property_id, suggested_days, suggested_times } = params;
        const userConfig = await getUserConfig(uid);

        if (!userConfig) {
          return JSON.stringify({
            success: false,
            error: "No se pudo obtener la configuración del usuario",
          });
        }

        // Obtener información de la propiedad
        const property = await getPropertyById(uid, property_id);
        
        if (!property) {
          // await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: ask_for_availability - property not found: ${property_id}`);
          return JSON.stringify({
            success: false,
            error: "No se encontró la propiedad especificada",
          });
        }

        const reportsNumber = userConfig.config.reportsNumber;
        const multimaiSession = process.env.MULTIMAI_WS_SESSION;

        console.log("[askForAvailabilityTool] Iniciando solicitud de disponibilidad");
        console.log("[askForAvailabilityTool] Propiedad:", property_id);
        console.log("[askForAvailabilityTool] Cliente:", userName, userPhone);

        console.log("[askForAvailabilityTool] Propiedad:", property);
        console.log("[askForAvailabilityTool] Días sugeridos:", suggested_days);
        console.log("[askForAvailabilityTool] Horarios sugeridos:", suggested_times);

        // Obtener los últimos 10 mensajes del usuario con sus IDs
        const recentMessages = await getRecentUserMessages(uid, userPhone, 10);
        console.log("[askForAvailabilityTool] Últimos mensajes del usuario:", recentMessages.length);

        // Formatear información de la propiedad
        const propertyInfo = `*${property.tipo_propiedad} "${property.nombre}"*
📍 ${property.ubicacion}
💰 ${property.tipo_operacion}`;

        // Crear el request en agents/multimai/requests con los mensajes del contexto
        // Filtrar undefined para evitar errores de Firebase
        const requestData = {
          request: `Solicitud de disponibilidad para visitar la propiedad ${property_id}`,
          userId: uid,
          customer: {
            name: userName,
            phone: userPhone,
          },
          context: {
            property_id,
            property_name: property.nombre,
            property_type: property.tipo_propiedad,
            property_operation: property.tipo_operacion,
            property_location: property.ubicacion,
            suggested_days: suggested_days && suggested_days.trim() !== "" ? suggested_days : "No especificado",
            suggested_times: suggested_times && suggested_times.trim() !== "" ? suggested_times : "No especificado",
            recentMessages: recentMessages.map(msg => {
              const msgData: { content: string; chat_message_id?: string } = {
                content: msg.content,
              };
              // Solo agregar chat_message_id si existe
              if (msg.chat_message_id) {
                msgData.chat_message_id = msg.chat_message_id;
              }
              return msgData;
            }),
          },
          workflowStatus: "pending",
          timestamp: new Date(),
        };

        const requestRef = await db
          .collection("agents/multimai/requests")
          .add(requestData);
        const requestId = requestRef.id;

        console.log("[askForAvailabilityTool] Request creado:", requestId);

        // Enviar mensaje al número de reportes con información de la propiedad
        const hasSuggestions = (suggested_days && suggested_days.trim() !== "") || (suggested_times && suggested_times.trim() !== "");
        const requestMessage = hasSuggestions
            ? `Hola!, el número ${userPhone} (${userName}) consulta disponibilidad para visitar esta propiedad:\n\n${propertyInfo}\n\n*Días sugeridos:* ${suggested_days && suggested_days.trim() !== "" ? suggested_days : "No especificado"}\n*Horarios sugeridos:* ${suggested_times && suggested_times.trim() !== "" ? suggested_times : "No especificado"}\n\n_Request ID: ${requestId}_`
            : `Hola!, el número ${userPhone} (${userName}) consulta disponibilidad para visitar esta propiedad:\n\n${propertyInfo}\n\n_Request ID: ${requestId}_`;

        await saveMultimaiMessage(userPhone, "assistant", requestMessage);
        // await saveConversationMessage(uid, userPhone, 'assistant', `tool executed: ask_for_availability - request message: ${requestMessage}`);

        await wsProxyClient.post(`/ws/send-message`, {
          chatId: reportsNumber,
          session: multimaiSession,
          messages: [
            {
              type: "text",
              payload: {
                content: requestMessage,
              },
            },
          ],
        });

        console.log(
          "[askForAvailabilityTool] ✅ Mensaje enviado al dueño. Request ID:",
          requestId,
        );

        // NO iniciar workflow - la respuesta llegará después
        // Retornar inmediatamente para que el bot pueda continuar
        return JSON.stringify({
          success: true,
          requestId: requestId,
          message: "Ok, le consulto al dueño sobre la disponibilidad y te aviso en cuanto me responda. ¿Hay algo más en lo que pueda ayudarte?",
        });
      } catch (error) {
        console.error("[askForAvailabilityTool] ❌ Error:", error);
        return JSON.stringify({
          success: false,
          message:
            "Hubo un error procesando la solicitud. Por favor intenta de nuevo.",
          error: String(error),
        });
      }
    },
  });

// Tool: cancel_visit
export const cancelVisitTool = (
  uid: string,
  userPhone: string,
  userName: string,
) =>
  tool({
    description:
      "Cancela la visita de un cliente específico. Busca al visitante en las visitas programadas de una propiedad y lo elimina de la lista de visitantes.",
    inputSchema: z.object({
      property_id: z.string().describe("ID de la propiedad de la visita a cancelar"),
    }),
    execute: async ({ property_id }) => {
      try {
        console.log("[cancelVisitTool] Iniciando cancelación de visita");
        console.log("[cancelVisitTool] Property ID:", property_id);
        console.log("[cancelVisitTool] User Phone:", userPhone);

        await saveConversationMessage(
          uid,
          userPhone,
          "assistant",
          `tool executed: cancel_visit with parameters: ${JSON.stringify({ property_id })}`,
          undefined,
          true
        );

        // Find all scheduled visits for this property
        const visitsSnapshot = await getVisitsCollection(uid)
          .where("propertyId", "==", property_id)
          .where("status", "==", "programada")
          .get();

        if (visitsSnapshot.empty) {
          await saveConversationMessage(
            uid,
            userPhone,
            "assistant",
            `tool executed: cancel_visit - no scheduled visits found`,
            undefined,
            true
          );
          return JSON.stringify({
            success: false,
            message: "No encontré visitas programadas para esta propiedad",
          });
        }

        // Find the visit where this user is registered
        let visitToUpdate: any = null;
        let visitorIndex = -1;

        for (const doc of visitsSnapshot.docs) {
          const visitData = doc.data();
          const visitors = visitData.visitors || [];
          const index = visitors.findIndex(
            (v: any) => v.clientPhone === userPhone,
          );

          if (index !== -1) {
            visitToUpdate = { id: doc.id, ...visitData };
            visitorIndex = index;
            break;
          }
        }

        if (!visitToUpdate) {
          await saveConversationMessage(
            uid,
            userPhone,
            "assistant",
            `tool executed: cancel_visit - user not found in any visit`,
            undefined,
            true
          );
          return JSON.stringify({
            success: false,
            message: "No encontré tu registro en ninguna visita para esta propiedad",
          });
        }

        // Remove the visitor from the visit
        const visitRef = getVisitsCollection(uid).doc(visitToUpdate.id);
        const updatedVisitors = visitToUpdate.visitors.filter(
          (_: any, index: number) => index !== visitorIndex,
        );

        await visitRef.update({
          visitors: updatedVisitors,
          currentInterested: Math.max(0, visitToUpdate.currentInterested - 1),
        });

        // Delete reminders for this user and visit
        try {
          await deleteVisitReminders(uid, userPhone, visitToUpdate.id);
          console.log("[cancelVisitTool] Visit reminders deleted successfully");
        } catch (reminderError) {
          console.error("[cancelVisitTool] Error deleting reminders:", reminderError);
          // Don't fail the cancellation if reminder deletion fails
        }

        const visitDate = visitToUpdate.date.toDate().toLocaleDateString("es-AR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
        });

        await saveConversationMessage(
          uid,
          userPhone,
          "assistant",
          `tool executed: cancel_visit - visit cancelled successfully for date ${visitDate} at ${visitToUpdate.startTime}`,
          undefined,
          true
        );

        console.log("[cancelVisitTool] ✅ Visita cancelada exitosamente");

        return JSON.stringify({
          success: true,
          message: `Tu visita del ${visitDate} a las ${visitToUpdate.startTime} ha sido cancelada exitosamente`,
          visit_date: visitDate,
          visit_time: visitToUpdate.startTime,
        });
      } catch (error) {
        console.error("[cancelVisitTool] ❌ Error:", error);
        return JSON.stringify({
          success: false,
          message: "Hubo un error al cancelar la visita. Por favor intenta de nuevo.",
          error: String(error),
        });
      }
    },
  });

// Tool: reschedule_visit
export const rescheduleVisitTool = (
  uid: string,
  userPhone: string,
  userName: string,
) =>
  tool({
    description:
      "Inicia el proceso de reprogramación de una visita. Busca la visita existente del cliente, la cancela y retorna información para que el agente pregunte por la nueva fecha. Después de obtener la nueva fecha, el agente debe usar get_availability y luego create_visit/add_visitor.",
    inputSchema: z.object({
      property_id: z.string().describe("ID de la propiedad de la visita a reprogramar"),
    }),
    execute: async ({ property_id }) => {
      try {
        console.log("[rescheduleVisitTool] Iniciando reprogramación de visita");
        console.log("[rescheduleVisitTool] Property ID:", property_id);
        console.log("[rescheduleVisitTool] User Phone:", userPhone);

        await saveConversationMessage(
          uid,
          userPhone,
          "assistant",
          `tool executed: reschedule_visit with parameters: ${JSON.stringify({ property_id })}`,
          undefined,
          true
        );

        // Find all scheduled visits for this property
        const visitsSnapshot = await getVisitsCollection(uid)
          .where("propertyId", "==", property_id)
          .where("status", "==", "programada")
          .get();

        if (visitsSnapshot.empty) {
          console.log("[rescheduleVisitTool] No visitas programadas encontradas para la propiedad", property_id);
          await saveConversationMessage(
            uid,
            userPhone,
            "assistant",
            `tool executed: reschedule_visit - no scheduled visits found`,
            undefined,
            true
          );
          return JSON.stringify({
            success: false,
            message: "No encontré visitas programadas para esta propiedad",
            should_ask_for_new_date: false,
          });
        }

        // Find the visit where this user is registered
        let visitToUpdate: any = null;
        let visitorIndex = -1;

        for (const doc of visitsSnapshot.docs) {
          const visitData = doc.data();
          const visitors = visitData.visitors || [];
          const index = visitors.findIndex(
            (v: any) => v.clientPhone === userPhone,
          );

          if (index !== -1) {
            visitToUpdate = { id: doc.id, ...visitData };
            visitorIndex = index;
            break;
          }
        }

        if (!visitToUpdate) {
          console.log("[rescheduleVisitTool] No visitas programadas encontradas para la propiedad", property_id);
          await saveConversationMessage(
            uid,
            userPhone,
            "assistant",
            `tool executed: reschedule_visit - user not found in any visit`,
            undefined,
            true
          );
          return JSON.stringify({
            success: false,
            message: "No encontré tu registro en ninguna visita para esta propiedad",
            should_ask_for_new_date: false,
          });
        }

        // Remove the visitor from the old visit
        const visitRef = getVisitsCollection(uid).doc(visitToUpdate.id);
        const updatedVisitors = visitToUpdate.visitors.filter(
          (_: any, index: number) => index !== visitorIndex,
        );

        await visitRef.update({
          visitors: updatedVisitors,
          currentInterested: Math.max(0, visitToUpdate.currentInterested - 1),
        });

        // Delete reminders for this user and visit
        try {
          await deleteVisitReminders(uid, userPhone, visitToUpdate.id);
          console.log("[rescheduleVisitTool] Visit reminders deleted successfully");
        } catch (reminderError) {
          console.error("[rescheduleVisitTool] Error deleting reminders:", reminderError);
          // Don't fail the rescheduling if reminder deletion fails
        }

        const oldVisitDate = visitToUpdate.date.toDate().toLocaleDateString("es-AR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
        });

        await saveConversationMessage(
          uid,
          userPhone,
          "assistant",
          `tool executed: reschedule_visit - old visit cancelled, ready for new scheduling. Old date: ${oldVisitDate} at ${visitToUpdate.startTime}`,
          undefined,
          true
        );

        console.log("[rescheduleVisitTool] ✅ Visita anterior cancelada, listo para reprogramar");

        return JSON.stringify({
          success: true,
          message: `He cancelado tu visita anterior del ${oldVisitDate} a las ${visitToUpdate.startTime}. Ahora dime, ¿cuándo te gustaría visitar la propiedad?`,
          old_visit_date: oldVisitDate,
          old_visit_time: visitToUpdate.startTime,
          property_id: property_id,
          should_ask_for_new_date: true,
        });
      } catch (error) {
        console.error("[rescheduleVisitTool] ❌ Error:", error);
        return JSON.stringify({
          success: false,
          message: "Hubo un error al reprogramar la visita. Por favor intenta de nuevo.",
          error: String(error),
          should_ask_for_new_date: false,
        });
      }
    },
  });

// Tool: log_feedback
export const logFeedbackTool = (
  uid: string,
  userPhone: string,
  userName: string,
) =>
  tool({
    description:
      "Registra el feedback del cliente y envía una notificación al dueño. Usa esta tool cuando el cliente comparta su opinión, experiencia o comentarios sobre una propiedad o el servicio.",
    inputSchema: z.object({
      feedback: z.string().describe("El feedback o comentario del cliente"),
      property_id: z
        .string()
        .optional()
        .describe("ID de la propiedad relacionada al feedback (opcional)"),
      feedback_type: z
        .enum(["property", "service", "visit", "general"])
        .optional()
        .describe("Tipo de feedback: property (sobre una propiedad), service (sobre el servicio), visit (sobre una visita), general (comentario general)"),
    }),
    execute: async ({ feedback, property_id, feedback_type = "general" }) => {
      try {
        console.log("[logFeedbackTool] Logging feedback");
        console.log("[logFeedbackTool] User:", userName, userPhone);
        console.log("[logFeedbackTool] Feedback:", feedback);
        console.log("[logFeedbackTool] Type:", feedback_type);

        await saveConversationMessage(
          uid,
          userPhone,
          "assistant",
          `tool executed: log_feedback with parameters: ${JSON.stringify({ feedback, property_id, feedback_type })}`,
          undefined,
          true
        );

        const userConfig = await getUserConfig(uid);

        if (!userConfig) {
          return JSON.stringify({
            success: false,
            message: "Gracias por tu feedback. Lo hemos registrado exitosamente.",
          });
        }

        // Store feedback in Firebase
        const feedbackData: any = {
          userId: uid,
          customer: {
            name: userName,
            phone: userPhone,
          },
          feedback: feedback,
          feedbackType: feedback_type,
          timestamp: new Date(),
          status: "pending_review",
        };

        if (property_id) {
          // Get property details if property_id is provided
          const property = await getPropertyById(uid, property_id);
          if (property) {
            feedbackData.property = {
              id: property_id,
              name: property.nombre,
              type: property.tipo_propiedad,
              location: property.ubicacion,
            };
          }
        }

        const feedbackRef = await db
          .collection("agents/multimai/feedback")
          .add(feedbackData);

        console.log("[logFeedbackTool] Feedback stored with ID:", feedbackRef.id);

        // Send notification to owner
        const reportsNumber = userConfig.config.reportsNumber;
        const multimaiSession = process.env.MULTIMAI_WS_SESSION;

        let messageToOwner = `📝 *Nuevo feedback de ${userName}* (${userPhone})\n\n`;
        messageToOwner += `*Tipo:* ${feedback_type}\n`;
        
        if (property_id && feedbackData.property) {
          messageToOwner += `*Propiedad:* ${feedbackData.property.name} (${feedbackData.property.type})\n`;
          messageToOwner += `*Ubicación:* ${feedbackData.property.location}\n`;
        }
        
        messageToOwner += `\n*Comentario:*\n${feedback}\n`;
        messageToOwner += `\n_Feedback ID: ${feedbackRef.id}_`;

        await saveConversationMessage(
          uid,
          userPhone,
          "assistant",
          `tool executed: log_feedback - message sent to owner: ${messageToOwner}`,
          undefined,
          true
        );

        await wsProxyClient.post(`/ws/send-message`, {
          chatId: reportsNumber,
          session: multimaiSession,
          messages: [
            {
              type: "text",
              payload: {
                content: messageToOwner,
              },
            },
          ],
        });

        await saveMultimaiMessage(userPhone, "assistant", messageToOwner);

        console.log("[logFeedbackTool] ✅ Feedback enviado al dueño");

        return JSON.stringify({
          success: true,
          feedback_id: feedbackRef.id,
          message: "Muchas gracias por tu feedback! Lo he registrado y el dueño será notificado.",
        });
      } catch (error) {
        console.error("[logFeedbackTool] ❌ Error:", error);
        return JSON.stringify({
          success: false,
          message: "Gracias por tu feedback. Lo hemos registrado exitosamente.",
          error: String(error),
        });
      }
    },
  });

// Tool: create_reminder
export const createReminderTool = (
  uid: string,
  userPhone: string,
  userName: string,
) =>
  tool({
    description:
      "Crea un recordatorio para el cliente. Úsalo cuando el cliente necesite ser recordado sobre algo en el futuro (visita, documentación, seguimiento, etc.).",
    inputSchema: z.object({
      toRemember: z
        .string()
        .describe("Texto descriptivo de qué se debe recordar al cliente"),
      eventDateTime: z
        .string()
        .describe("Fecha y hora del evento a recordar en formato ISO (YYYY-MM-DDTHH:MM:SS) o fecha en formato YYYY-MM-DD"),
      metadata: z
        .record(z.string(), z.any())
        .optional()
        .describe("Datos adicionales útiles para el recordatorio (opcional). Por ejemplo: property_id, visit_id, etc."),
    }),
    execute: async ({ toRemember, eventDateTime, metadata = {} }) => {
      try {
        console.log("[createReminderTool] Creating reminder");
        console.log("[createReminderTool] User:", userName, userPhone);
        console.log("[createReminderTool] To remember:", toRemember);
        console.log("[createReminderTool] Event date time:", eventDateTime);

        await saveConversationMessage(
          uid,
          userPhone,
          "assistant",
          `tool executed: create_reminder with parameters: ${JSON.stringify({ toRemember, eventDateTime, metadata })}`,
          undefined,
          true
        );

        // Get recent messages for context
        const recentMessages = await getRecentUserMessages(uid, userPhone, 10);
        console.log("[createReminderTool] Recent messages:", recentMessages.length);

        // Parse eventDateTime to Date
        let eventDateTimeParsed: Date;
        try {
          // Try parsing as ISO format first
          if (eventDateTime.includes('T')) {
            eventDateTimeParsed = new Date(eventDateTime);
          } else {
            // If just date, set time to 00:00:00
            eventDateTimeParsed = new Date(eventDateTime + 'T00:00:00');
          }
          
          // Validate date
          if (isNaN(eventDateTimeParsed.getTime())) {
            throw new Error('Invalid date format');
          }
        } catch (dateError) {
          console.error("[createReminderTool] Invalid date format:", eventDateTime);
          return JSON.stringify({
            success: false,
            error: `Formato de fecha inválido: ${eventDateTime}. Usa formato YYYY-MM-DD o YYYY-MM-DDTHH:MM:SS`,
          });
        }

        // Create reminder data
        const reminderData = {
          userId: uid,
          customer: {
            name: userName,
            phone: userPhone,
          },
          context: {
            recentMessages: recentMessages.map(msg => ({
              content: msg.content,
              chat_message_id: msg.chat_message_id,
              timestamp: msg.timestamp,
            })),
            metadata: metadata,
          },
          timestamp: new Date(),
          eventDateTime: eventDateTimeParsed,
          toRemember: toRemember,
        };

        // Save reminder to Firebase
        const reminderRef = await db
          .collection(`users/${uid}/reminders`)
          .add(reminderData);

        console.log("[createReminderTool] Reminder created with ID:", reminderRef.id);

        // Format event date for user-friendly message
        const eventDateStr = eventDateTimeParsed.toLocaleDateString("es-AR", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const eventTimeStr = eventDateTimeParsed.toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
        });

        await saveConversationMessage(
          uid,
          userPhone,
          "assistant",
          `tool executed: create_reminder - reminder created: ${reminderRef.id} for ${eventDateStr}`,
          undefined,
          true
        );

        return JSON.stringify({
          success: true,
          reminder_id: reminderRef.id,
          message: `Perfecto, he creado un recordatorio para el ${eventDateStr}${eventDateTimeParsed.getHours() !== 0 || eventDateTimeParsed.getMinutes() !== 0 ? ` a las ${eventTimeStr}` : ''}. Te recordaré: ${toRemember}`,
          event_date: eventDateStr,
          event_time: eventTimeStr,
        });
      } catch (error) {
        console.error("[createReminderTool] ❌ Error:", error);
        return JSON.stringify({
          success: false,
          error: `Error al crear el recordatorio: ${String(error)}`,
        });
      }
    },
  });

/**
 * Get Visit Status Tool
 * Retrieves detailed information about a scheduled visit
 */
export const getVisitStatusTool = (uid: string) =>
  tool({
    description: "Obtener el estado y detalles completos de una visita programada usando su visit_id. Devuelve información sobre si está activa o cancelada, notas, dirección de la propiedad, fecha y hora.",
    inputSchema: z.object({
      visit_id: z.string().describe("ID de la visita a consultar"),
    }),
    execute: async ({ visit_id }) => {
      try {
        console.log(`[getVisitStatusTool] Consultando visita: ${visit_id}`);

        // Get visit document
        const visitRef = db.collection(propertyVisits(uid)).doc(visit_id);
        const visitDoc = await visitRef.get();

        if (!visitDoc.exists) {
          return JSON.stringify({
            success: false,
            error: "No se encontró la visita con ese ID",
            visit_id,
          });
        }

        const visitData = visitDoc.data();

        // Get property details to include address
        let propertyInfo = null;
        if (visitData?.propertyId) {
          try {
            const property = await getPropertyById(uid, visitData.propertyId);
            if (property) {
              propertyInfo = {
                nombre: property.nombre,
                direccion: (property as any).ubicacion_simple || property.ubicacion || property.direccion,
                tipo: property.tipo_propiedad,
              };
            }
          } catch (error) {
            console.error("[getVisitStatusTool] Error obteniendo propiedad:", error);
          }
        }

        // Format date and time
        let formattedDate = '';
        let formattedTime = '';
        if (visitData?.visitDateTime) {
          const visitDate = visitData.visitDateTime.toDate ? visitData.visitDateTime.toDate() : new Date(visitData.visitDateTime);
          formattedDate = visitDate.toLocaleDateString('es-AR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });
          formattedTime = visitDate.toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit'
          });
        }

        const visitStatus = {
          visit_id,
          status: visitData?.status || 'active',
          is_active: visitData?.status !== 'cancelled',
          is_cancelled: visitData?.status === 'cancelled',
          cancellation_reason: visitData?.cancellationReason || null,
          date: formattedDate,
          time: formattedTime,
          raw_datetime: visitData?.visitDateTime,
          notes: visitData?.notes || null,
          property: propertyInfo,
          property_id: visitData?.propertyId || null,
          visitors: visitData?.visitors || [],
          created_at: visitData?.createdAt,
          modified_at: visitData?.modifiedAt,
        };

        await saveConversationMessage(
          uid,
          visitData?.visitors?.[0]?.phone || 'unknown',
          "assistant",
          `tool executed: get_visit_status - visit queried: ${visit_id}`,
          undefined,
          true
        );

        console.log(`[getVisitStatusTool] ✅ Visita encontrada: ${visit_id}, status: ${visitStatus.status}`);

        return JSON.stringify({
          success: true,
          visit: visitStatus,
          message: `Visita ${visit_id}: ${visitStatus.is_cancelled ? 'CANCELADA' : 'ACTIVA'}${visitStatus.date ? ` para el ${visitStatus.date} a las ${visitStatus.time}` : ''}`,
        });

      } catch (error) {
        console.error("[getVisitStatusTool] ❌ Error:", error);
        return JSON.stringify({
          success: false,
          error: `Error al consultar la visita: ${String(error)}`,
          visit_id,
        });
      }
    },
  });

// Tool: search_context
export const searchContextTool = (uid: string, userPhone: string) =>
  tool({
    description:
      "Busca información en los documentos de contexto cargados por el usuario (como políticas, reglamentos, información de la empresa, etc.). Usa esta tool cuando el cliente pregunte sobre información específica que podría estar en los documentos de contexto.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("La consulta o pregunta a buscar en los documentos de contexto"),
      document_labels: z
        .array(z.string())
        .optional()
        .describe("Etiquetas específicas de documentos donde buscar (opcional, si no se especifica busca en todos)"),
    }),
    execute: async ({ query, document_labels }) => {
      try {
        console.log("[searchContextTool] Starting context search");
        console.log("[searchContextTool] Query:", query);
        console.log("[searchContextTool] Document labels filter:", document_labels);

        await saveConversationMessage(
          uid,
          userPhone,
          "assistant",
          `tool executed: search_context with query: "${query}"`,
          undefined,
          true
        );

        // Build RAG keys
        const keys = [uid, "agent-context"];

        // Search in RAG
        const ragResults = await retrievalRAG(keys, query, 5);

        if (ragResults.length === 0) {
          console.log("[searchContextTool] No results found");
          return JSON.stringify({
            success: true,
            found: false,
            message: "No encontré información relevante en los documentos de contexto.",
            results: [],
          });
        }

        // Filter by document labels if specified
        let filteredResults = ragResults;
        if (document_labels && document_labels.length > 0) {
          filteredResults = ragResults.filter((result) => {
            const resultLabel = result.metadata?.label || "";
            return document_labels.some(
              (label) =>
                resultLabel.toLowerCase().includes(label.toLowerCase()) ||
                label.toLowerCase().includes(resultLabel.toLowerCase())
            );
          });
        }

        console.log(`[searchContextTool] Found ${filteredResults.length} relevant results`);

        // Format results
        const formattedResults = filteredResults.map((result) => ({
          document_label: result.metadata?.label || "Sin etiqueta",
          propositions: result.propositions?.slice(0, 5) || [],
          similarity: result.similarity,
          original_text_preview: result.originalText?.substring(0, 200) || "",
        }));

        // Create a summary of the found information
        const allPropositions = formattedResults.flatMap((r) =>
          r.propositions.map((p) => `[${r.document_label}] ${p}`)
        );

        const summary =
          allPropositions.length > 0
            ? allPropositions.slice(0, 10).join("\n")
            : "No se encontraron proposiciones relevantes.";

        await saveConversationMessage(
          uid,
          userPhone,
          "assistant",
          `tool executed: search_context - found ${filteredResults.length} results`,
          undefined,
          true
        );

        return JSON.stringify({
          success: true,
          found: filteredResults.length > 0,
          count: filteredResults.length,
          summary,
          results: formattedResults,
          message:
            filteredResults.length > 0
              ? `Encontré ${filteredResults.length} resultado(s) relevante(s) en los documentos de contexto.`
              : "No encontré información relevante en los documentos de contexto.",
        });
      } catch (error) {
        console.error("[searchContextTool] ❌ Error:", error);
        return JSON.stringify({
          success: false,
          found: false,
          error: `Error al buscar en documentos de contexto: ${String(error)}`,
          results: [],
        });
      }
    },
  });
