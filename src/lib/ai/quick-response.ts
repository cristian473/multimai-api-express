import { generateObject, generateText } from "ai";
import { z } from "zod";
import { getModel } from "./openrouter";
import { AI_CONFIG } from "./config";

export interface QuickResponseResult {
  shouldSend: boolean;
  score: number;
  reason: string;
  message: string | null;
}

/**
 * Genera un mensaje rápido de confirmación/espera antes de procesar la solicitud completa
 * Retorna objeto con score, reason y mensaje
 */
export async function generateQuickWaitingMessage(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  threshold: number = 0.7
): Promise<QuickResponseResult> {
  try {
    console.log("[QuickResponse] Analyzing if quick response is needed...");

    // Preparar historial reciente (últimos 5 mensajes)
    const recentHistory = conversationHistory
      .slice(-5)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const prompt = `<task>
Eres un asistente que evalúa si se debe enviar un mensaje rápido de confirmación/espera al usuario.

<contexto>
<historial_reciente>
${recentHistory}
</historial_reciente>

<mensaje_actual_usuario>
${userMessage}
</mensaje_actual_usuario>
</contexto>

<instrucciones>
1. Analiza el mensaje del usuario y determina la probabilidad (0.0 a 1.0) de que requiera un mensaje de espera
2. Asigna un score alto (0.7-1.0) si:
   - Requiere búsqueda de propiedades
   - Necesita consultar disponibilidad
   - Debe agendar/modificar visitas
   - Requiere ejecutar herramientas que toman tiempo
   - Es una pregunta compleja que necesita procesamiento

3. Asigna un score bajo (0.0-0.3) si:
   - Es un saludo simple ("hola", "buenos días")
   - Es una confirmación breve ("sí", "ok", "gracias")
   - Es una pregunta muy simple que se responde rápido
   - Es solo una respuesta corta del usuario

4. Asigna score medio (0.4-0.6) para casos intermedios

5. Si el score es >= 0.7, genera un mensaje CORTO (máximo 5-7 palabras) que:
   - Sea natural y conversacional en español argentino (sin usar che, ni vos)
   - Confirme que estás procesando la solicitud
   - NO use emojis
   - NO sea demasiado formal
   - Sea específico a la acción
</instrucciones>

</task>`;

    const model = getModel(AI_CONFIG?.QUICK_RESPONSE_MODEL ?? "openai/gpt-4o-mini");
    const schema = z.object({
      score: z.coerce.number(),
      reason: z.string(),
      message: z.string().nullable(),
    });

    let result;
    try {
      const { object } = await generateObject({
        model: model as any,
        prompt: prompt,
        schema: schema,
        temperature: 0.5,
      });
      result = object;
    } catch (error: any) {
      console.error("[QuickResponse] Error in generateObject:", error);
      // Fallback if model fails
      result = {
        score: 0,
        reason: "Error generating response",
        message: null
      };
    }

    const quickResponseResult: QuickResponseResult = {
      shouldSend: result.score >= threshold,
      score: result.score || 0,
      reason: result.reason || 'No reason provided',
      message: result.score >= threshold ? result.message : null
    };

    console.log(`[QuickResponse] Score: ${quickResponseResult.score.toFixed(2)} (threshold: ${threshold})`);
    console.log(`[QuickResponse] Reason: ${quickResponseResult.reason}`);
    console.log(`[QuickResponse] Should send: ${quickResponseResult.shouldSend}`);

    if (quickResponseResult.shouldSend && quickResponseResult.message) {
      console.log(`[QuickResponse] Message: "${quickResponseResult.message}"`);
    }

    return quickResponseResult;
  } catch (error) {
    console.error("[QuickResponse] Error generating quick response:", error);
    return {
      shouldSend: false,
      score: 0,
      reason: 'Error processing request',
      message: null
    };
  }
}
