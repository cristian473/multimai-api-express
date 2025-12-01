/**
 * Response Writer
 * Composes the final response from worker results
 * Does NOT execute any tools - only synthesis and composition
 */

import { generateText } from 'ai';
import { getModel } from '../../openrouter';
import { AI_CONFIG } from '../../config';
import type { WriterInput, WriterOutput, WorkerResult, ActionPlan } from '../types';
import type { GuidelineMatch } from '../../types/guideline';

export interface WriterConfig {
  maxRetries: number;
  includeEmojis: boolean;
  maxResponseLength: number;
}

const DEFAULT_CONFIG: WriterConfig = {
  maxRetries: 2,
  includeEmojis: true,
  maxResponseLength: 2000
};

export class ResponseWriter {
  private config: WriterConfig;
  private model: ReturnType<typeof getModel>;

  constructor(config: Partial<WriterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.model = getModel(AI_CONFIG?.CASCADE?.WRITER_MODEL ?? AI_CONFIG?.COMPOSER_MODEL_MEDIUM ?? 'openai/gpt-4o');
  }

  /**
   * Build the composition prompt
   */
  private buildCompositionPrompt(input: WriterInput): string {
    let prompt = `<writer_prompt>\n\n`;

    prompt += `  <role>\n`;
    prompt += `    <descripcion>Eres el redactor final de respuestas para un agente inmobiliario por WhatsApp</descripcion>\n`;
    prompt += `    <objetivo>Sintetizar la información de los workers y componer una respuesta natural y útil</objetivo>\n`;
    prompt += `    <restricciones>\n`;
    prompt += `      <restriccion>NO puedes ejecutar herramientas - solo redactar</restriccion>\n`;
    prompt += `      <restriccion>Debes usar la información proporcionada por los workers</restriccion>\n`;
    prompt += `      <restriccion>Responde en español, tono amigable y profesional</restriccion>\n`;
    prompt += `      <restriccion>NO repitas información que ya haya sido enviada en la conversación</restriccion>\n`;
    prompt += `      <restriccion>NO repitas mensajes que ya haya sido enviados en la conversación</restriccion>\n`;
    prompt += `      <restriccion>NO te presentes en cada interaccion, solo cuando te saludan</restriccion>\n`;
    prompt += `    </restricciones>\n`;
    prompt += `  </role>\n\n`;

    prompt += `  <mensaje_usuario>\n`;
    prompt += `    <contenido>${input.userMessage}</contenido>\n`;
    prompt += `  </mensaje_usuario>\n\n`;

    // Plan context
    prompt += `  <plan_ejecutado>\n`;
    prompt += `    <ir_directo_a_writer>${input.plan.directToWriter}</ir_directo_a_writer>\n`;
    prompt += `    <razon>${input.plan.reasoning}</razon>\n`;
    prompt += `    <complejidad>${input.plan.estimatedComplexity}</complejidad>\n`;
    prompt += `  </plan_ejecutado>\n\n`;

    // Worker results - the most important part
    if (input.workerResults.length > 0) {
      prompt += `  <resultados_workers>\n`;
      prompt += `    <nota>IMPORTANTE: Usa esta información para construir tu respuesta</nota>\n\n`;
      
      input.workerResults.forEach(result => {
        prompt += `    <worker id="${result.workerId}" status="${result.status}">\n`;
        
        if (result.status === 'success') {
          prompt += `      <respuesta>${result.response}</respuesta>\n`;
          
          // Include tool execution details if any
          if (result.toolsExecuted.length > 0) {
            prompt += `      <herramientas_ejecutadas>\n`;
            result.toolsExecuted.forEach(tool => {
              const toolResultStr = tool.result !== undefined 
                ? JSON.stringify(tool.result).substring(0, 500) 
                : 'ejecutado';
              prompt += `        <herramienta nombre="${tool.toolName}">\n`;
              prompt += `          <args>${JSON.stringify(tool.args ?? {})}</args>\n`;
              prompt += `          <resultado>${toolResultStr}</resultado>\n`;
              prompt += `        </herramienta>\n`;
            });
            prompt += `      </herramientas_ejecutadas>\n`;
          }
          
          prompt += `      <validacion score="${result.validation.score}" passed="${result.validation.passed}">\n`;
          if (result.validation.feedback) {
            prompt += `        <feedback>${result.validation.feedback}</feedback>\n`;
          }
          prompt += `      </validacion>\n`;
        } else if (result.status === 'failed') {
          prompt += `      <error>${result.error || 'Error desconocido'}</error>\n`;
          prompt += `      <nota>Debes comunicar elegantemente que hubo un problema con esta parte</nota>\n`;
        }
        
        prompt += `    </worker>\n\n`;
      });
      
      prompt += `  </resultados_workers>\n\n`;
    } else {
      prompt += `  <sin_workers>\n`;
      prompt += `    <nota>No se ejecutaron workers, responde directamente al usuario basándote en el contexto y las guidelines</nota>\n`;
      prompt += `  </sin_workers>\n\n`;
    }

    // Active guidelines for tone and style
    if (input.activeGuidelines.length > 0) {
      prompt += `  <guidelines_activas>\n`;
      prompt += `    <nota>Sigue estas guidelines para el tono y contenido de tu respuesta</nota>\n`;
      input.activeGuidelines.forEach(match => {
        const g = match.guideline;
        prompt += `    <guideline id="${g.id}">\n`;
        prompt += `      <accion>${g.action}</accion>\n`;
        prompt += `    </guideline>\n`;
      });
      prompt += `  </guidelines_activas>\n\n`;
    }

    // Glossary context
    if (input.glossaryContext) {
      prompt += `  <glosario>\n`;
      prompt += `    <nota>Términos inmobiliarios relevantes</nota>\n`;
      prompt += `    ${input.glossaryContext}\n`;
      prompt += `  </glosario>\n\n`;
    }

    // RAG context
    if (input.ragContext?.contextSummary) {
      prompt += `  <contexto_rag>\n`;
      prompt += `    <nota>Información adicional de documentos</nota>\n`;
      prompt += `    ${input.ragContext.contextSummary}\n`;
      prompt += `  </contexto_rag>\n\n`;
    }

    // Context variables from workflow (fecha, nombre_usuario, nombre_negocio, etc.)
    if (input.contextVariables && Object.keys(input.contextVariables).length > 0) {
      prompt += `  <variables_contexto>\n`;
      prompt += `    <nota>Información contextual importante para tu respuesta</nota>\n`;
      for (const [key, value] of Object.entries(input.contextVariables)) {
        prompt += `    <variable nombre="${key}">${value}</variable>\n`;
      }
      prompt += `  </variables_contexto>\n\n`;
    }

    // Formatting instructions
    prompt += `  <instrucciones_formato>\n`;
    prompt += `    <instruccion>Responde de forma natural y conversacional</instruccion>\n`;
    prompt += `    <instruccion>Para imágenes: usa formato Markdown ![descripción](url)</instruccion>\n`;
    prompt += `    <instruccion>Mantén el mensaje conciso pero completo</instruccion>\n`;
    prompt += `    <instruccion>Si un worker falló, comunica el problema de forma amable y ofrece alternativas</instruccion>\n`;
    prompt += `    <instruccion>NO menciones que eres un "asistente virtual" ni uses lenguaje robótico</instruccion>\n`;
    prompt += `  </instrucciones_formato>\n\n`;

    prompt += `</writer_prompt>`;

    return prompt;
  }

  /**
   * Compose the final response
   */
  async compose(input: WriterInput): Promise<WriterOutput> {
    const startTime = Date.now();
    console.log('[ResponseWriter] Starting composition...');
    console.log(`[ResponseWriter] Worker results: ${input.workerResults.length}`);

    const compositionPrompt = this.buildCompositionPrompt(input);

    const result = await generateText({
      model: this.model,
      system: compositionPrompt,
      messages: input.messages,
      maxOutputTokens: this.config.maxResponseLength
    });

    const response = result.text;
    const executionTimeMs = Date.now() - startTime;

    console.log(`[ResponseWriter] Composition completed in ${executionTimeMs}ms`);
    console.log(`[ResponseWriter] Response length: ${response.length} chars`);

    return {
      response,
      metadata: {
        usedWorkerResults: input.workerResults
          .filter(r => r.status === 'success')
          .map(r => r.workerId),
        executionTimeMs
      }
    };
  }

  /**
   * Create a simple fallback response when everything fails
   */
  createFallbackResponse(error: string, input: WriterInput): WriterOutput {
    console.log('[ResponseWriter] Creating fallback response due to error:', error);

    // Determine appropriate fallback based on context
    const isGreeting = input.activeGuidelines.some(g => g.guideline.id === 'greeting');
    const isSearch = input.activeGuidelines.some(g => g.guideline.id === 'search_properties');

    let fallbackMessage: string;

    if (isGreeting) {
      fallbackMessage = '¡Hola! 👋 ¿En qué puedo ayudarte hoy?';
    } else if (isSearch) {
      fallbackMessage = 'Disculpa, tuve un problema al buscar las propiedades. ¿Podrías indicarme nuevamente qué tipo de propiedad estás buscando?';
    } else {
      fallbackMessage = 'Disculpa, tuve un pequeño problema técnico. ¿Podrías repetirme tu consulta?';
    }

    return {
      response: fallbackMessage,
      metadata: {
        usedWorkerResults: [],
        executionTimeMs: 0
      }
    };
  }
}

/**
 * Merge multiple worker results into a coherent context for the writer
 */
export function mergeWorkerResults(results: WorkerResult[]): string {
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'failed');

  let merged = '';

  if (successful.length > 0) {
    merged += 'RESULTADOS EXITOSOS:\n';
    successful.forEach(r => {
      merged += `\n[${r.workerId}]:\n${r.response}\n`;
    });
  }

  if (failed.length > 0) {
    merged += '\nERRORES:\n';
    failed.forEach(r => {
      merged += `[${r.workerId}]: ${r.error || 'Error desconocido'}\n`;
    });
  }

  return merged;
}

