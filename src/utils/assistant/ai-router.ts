import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

// Define agent types
export enum AgentType {
  GENERAL_QUERIES = "general_queries",
  PROPERTY_QUERIES = "property_queries",
  VISIT_SCHEDULING = "visit_scheduling",
  UNKNOWN = "unknown"
}

// Schema for agent routing response
const routingSchema = z.object({
  agent_type: z.nativeEnum(AgentType),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  keywords: z.array(z.string())
});

const routingOutputParser = new JsonOutputParser<z.infer<typeof routingSchema>>();

const agentRoutingTemplate = PromptTemplate.fromTemplate(`
  Sistema de enrutamiento de conversaciones a agentes específicos.
  Analiza el siguiente historial de conversación y determina a qué agente debe ser dirigido basándose en el contexto completo y la intención principal del usuario.
  
  Agentes disponibles:
  1. Agente de consultas generales (${AgentType.GENERAL_QUERIES})
     - Preguntas generales sobre la empresa
     - Información básica
     - Dudas generales
  
  2. Agente de consulta de propiedades (${AgentType.PROPERTY_QUERIES})
     - Búsqueda de propiedades
     - Información específica de inmuebles
     - Precios y características
     - Disponibilidad de propiedades
  
  3. Agente de agenda visitas (${AgentType.VISIT_SCHEDULING})
     - Programación de visitas
     - Modificación de citas
     - Cancelación de visitas
     - Consultas sobre horarios disponibles
  
  Instrucciones de análisis:
  1. Revisa todo el historial de la conversación para entender el contexto completo
  2. Identifica la intención principal del usuario a través de la conversación
  3. Considera la progresión de la conversación (ej: de búsqueda de propiedades a agendar visita)
  4. Detecta cambios de tema o intención durante la conversación
  5. Prioriza los mensajes más recientes para determinar la intención actual
  
  Formato de respuesta JSON requerido:
  
    "agent_type": string,     // Tipo de agente según el enum AgentType
    "confidence": number,     // Valor entre 0 y 1 que indica la confianza en la clasificación
    "reasoning": string,      // Explicación del por qué se eligió este agente
    "keywords": string[],    // Palabras clave identificadas en la conversación
    "main_intent": string    // Intención principal identificada en la conversación
  
  
  Historial de conversación:
  {history}
  
  Analiza y responde SOLO con el objeto JSON según el formato especificado.
  `);

async function routeMessageToAgent(history: string) {
  try {
    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-4o-mini',
      temperature: 0.5
    });

    const chain = agentRoutingTemplate
      .pipe(model)
      .pipe(routingOutputParser);

    const response = await chain.invoke({ history });

    // Validate the response structure
    const validatedResponse = routingSchema.parse(response);

    // Only route to agent if confidence is above threshold
    if (validatedResponse.confidence < 0.6) {
      return {
        ...validatedResponse,
        agent_type: AgentType.UNKNOWN
      };
    }

    return validatedResponse;
  } catch (error) {
    console.error("Error routing message to agent:", error);
    throw new Error("No se pudo determinar el agente apropiado para el mensaje");
  }
}

// Helper function to check if message needs human intervention
function needsHumanIntervention(routingResult: z.infer<typeof routingSchema>): boolean {
  return (
    routingResult.agent_type === AgentType.UNKNOWN ||
    routingResult.confidence < 0.4 ||
    routingResult.keywords.some(keyword => 
      ['urgente', 'emergencia', 'problema', 'queja', 'reclamo'].includes(keyword.toLowerCase())
    )
  );
}

export default { 
  routeMessageToAgent, 
  needsHumanIntervention 
} as const;