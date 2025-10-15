import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

// Define the message structure
interface ChatMessage {
  role: string;
  message: string;
}

// Schema for property interest detection
const propertyInterestSchema = z.object({
  interested: z.boolean(),
  property_type: z.string().optional(),
  interest_reason: z.string().optional(),
  customer_requirement: z.string().optional(),
  interest_level: z.number().min(1).max(5).optional()
});

const propertyInterestOutputParser = new JsonOutputParser<z.infer<typeof propertyInterestSchema>>();

const propertyInterestTemplate = PromptTemplate.fromTemplate(`
Sistema de detección de interés en propiedades.
Analiza el siguiente historial de mensajes y determina si el usuario está interesado en alguna propiedad.

Formato de respuesta JSON requerido:
  "interested": boolean,  // Indica si el usuario está interesado en una propiedad
  "property_type": string, // Tipo de propiedad mencionada (ej: departamento, casa, oficina)
  "interest_reason": string, // Explicación del por qué se considera interesado
  "customer_requirement": string, // Requerimientos del cliente, que tipo de propiedad, ubicación, nro de habitaciones, todos los detalles de la propiedad que desea el cliente información.
  "interest_level": number // Nivel de interés del 1 al 5 (si hay interés)

Historial de mensajes:
{history}

Analiza y responde SOLO con el objeto JSON según el formato especificado.
`);

async function analyzePropertyInterest(history: string) {
  try {
    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-4o-mini',
      temperature: 0.5
    });

    const chain = propertyInterestTemplate
      .pipe(model)
      .pipe(propertyInterestOutputParser);

    const interestAnalysis = await chain.invoke({
      history
    });

    // Validate the interest analysis structure
    return propertyInterestSchema.parse(interestAnalysis);
  } catch (error) {
    console.error("Error analyzing property interest:", error);
    return { interested: false };
  }
}


// Schema para validar la similitud de requerimientos
const similaritySchema = z.object({
  is_duplicate: z.boolean(),
  similarity_score: z.number().min(0).max(1)
});

const similarityOutputParser = new JsonOutputParser<z.infer<typeof similaritySchema>>();

const similarityTemplate = PromptTemplate.fromTemplate(`
Sistema de validación de requerimientos inmobiliarios.
Compara un nuevo requerimiento con los almacenados y determina si es duplicado.

Formato de respuesta JSON requerido:
  "is_duplicate": boolean,  // Indica si el requerimiento ya existe
  "similarity_score": number // Valor de similitud entre 0 y 1

Requerimiento nuevo:
{new_requirement}

Requerimientos almacenados:
{stored_requirements}

Analiza y responde SOLO con el objeto JSON según el formato especificado.
`);

async function isDuplicateInterest(newRequirement:string, storedRequirements:string[]) {
  try {
    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: "gpt-4o-mini",
      temperature: 0.2
    });

    const chain = similarityTemplate
      .pipe(model)
      .pipe(similarityOutputParser);

    const similarityAnalysis = await chain.invoke({
      new_requirement: newRequirement,
      stored_requirements: storedRequirements.join(" | ")
    });

    return similaritySchema.parse(similarityAnalysis);
  } catch (error) {
    console.error("Error analyzing similarity:", error);
    return { is_duplicate: false, similarity_score: 0 };
  }
}

export default { isDuplicateInterest, analyzePropertyInterest };
