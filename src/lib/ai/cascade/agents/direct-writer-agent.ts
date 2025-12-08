/**
 * Direct Writer Agent
 * 
 * A simplified agent that receives guidelines, context variables, and tools,
 * executes everything in a single agent loop, and returns the response.
 * 
 * This replaces the cascade architecture (Classifier → Planner → Workers → Writer)
 * with a simpler: DirectWriterAgent → StyleValidator flow.
 */

import { generateText, stepCountIs, tool } from 'ai';
import { getModel } from '../../openrouter';
import { AI_CONFIG } from '../../config';
import type { GuidelineMatch } from '../../types/guideline';
import type { ContextSearchResult } from '../../micro-agents/context-search-agent';
import type { LLMMessage } from '../../context';

// Type helper for tools
type ToolSet = Record<string, ReturnType<typeof tool>>;

export interface DirectWriterInput {
  userMessage: string;
  messages: LLMMessage[];
  activeGuidelines: GuidelineMatch[];
  contextVariables: Record<string, string>;
  tools: ToolSet;
  glossaryContext?: string;
  ragContext?: ContextSearchResult | null;
}

export interface DirectWriterOutput {
  response: string;
  toolsExecuted: Array<{
    toolName: string;
    args: Record<string, any>;
    result: any;
  }>;
  metadata: {
    iterations: number;
    executionTimeMs: number;
  };
}

export interface DirectWriterConfig {
  maxSteps: number;
  maxTokens: number;
  temperature: number;
  model?: string;
}

const DEFAULT_CONFIG: DirectWriterConfig = {
  maxSteps: 5,
  maxTokens: 2000,
  temperature: 0.7,
  model: AI_CONFIG?.DIRECT_WRITER_MODEL ?? 'openai/gpt-4o'
};

export class DirectWriterAgent {
  private config: DirectWriterConfig;
  private model: ReturnType<typeof getModel>;

  constructor(config: Partial<DirectWriterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.model = getModel(this.config.model);
  }

  /**
   * Build the system prompt in XML format
   */
  private buildSystemPrompt(input: DirectWriterInput): string {
    let xml = `<direct_writer>\n\n`;

    // System role
    xml += `  <sistema>\n`;
    xml += `    <rol>Eres un asistente inmobiliario que atiende vía WhatsApp al interesado</rol>\n`;
    xml += `    <estilo>Breve, natural, profesional (español argentino)</estilo>\n`;
    xml += `  </sistema>\n\n`;

    // Instructions
    xml += `  <instrucciones>\n`;
    xml += `    <instruccion>Responde al mensaje del usuario siguiendo las guidelines activas</instruccion>\n`;
    xml += `    <instruccion>Usa las herramientas disponibles cuando sea necesario para obtener información</instruccion>\n`;
    xml += `    <instruccion>Mantener tono natural y conversacional</instruccion>\n`;
    xml += `    <instruccion>Responder SIEMPRE en español argentino profesional</instruccion>\n`;
    xml += `    <instruccion>Responde brevemente y conciso</instruccion>\n`;
    xml += `    <instruccion>No seas repetitivo</instruccion>\n`;
    xml += `    <instruccion>NO repitas información que ya haya sido enviada en la conversación</instruccion>\n`;
    xml += `    <instruccion>NO te presentes en cada interaccion, solo cuando te saludan</instruccion>\n`;
    xml += `    <instruccion>Envía SIEMPRE las imágenes en el mensaje usando el formato Markdown: ![(...image caption/description...)](url)</instruccion>\n`;
    xml += `  </instrucciones>\n\n`;

    // Context variables
    if (input.contextVariables && Object.keys(input.contextVariables).length > 0) {
      xml += `  <variables_contexto>\n`;
      Object.entries(input.contextVariables).forEach(([name, value]) => {
        xml += `    <variable nombre="${name}">${value}</variable>\n`;
      });
      xml += `  </variables_contexto>\n\n`;
    }

    // Active guidelines
    if (input.activeGuidelines && input.activeGuidelines.length > 0) {
      xml += `  <guidelines_activas>\n`;
      xml += `    <nota>Sigue estas guidelines para responder al usuario</nota>\n`;
      input.activeGuidelines.forEach((match) => {
        const g = match.guideline;
        xml += `    <guideline id="${g.id}" prioridad="${g.priority}">\n`;
        xml += `      <condicion>${g.condition}</condicion>\n`;
        xml += `      <accion>${g.action}</accion>\n`;
        if (g.tools && g.tools.length > 0) {
          xml += `      <herramientas_sugeridas>${g.tools.join(', ')}</herramientas_sugeridas>\n`;
        }
        xml += `    </guideline>\n`;
      });
      xml += `  </guidelines_activas>\n\n`;
    }

    // Glossary context
    if (input.glossaryContext) {
      xml += `  <glosario>\n`;
      xml += `    <nota>Términos inmobiliarios relevantes</nota>\n`;
      xml += `    ${input.glossaryContext}\n`;
      xml += `  </glosario>\n\n`;
    }

    // RAG context from documents
    if (input.ragContext?.contextSummary) {
      xml += `  <contexto_documentos>\n`;
      xml += `    <descripcion>Información relevante encontrada en documentos de contexto</descripcion>\n`;
      xml += `    <documentos_consultados>${input.ragContext.relevantDocuments.join(', ')}</documentos_consultados>\n`;
      xml += `    <resumen>${input.ragContext.contextSummary}</resumen>\n`;
      xml += `    <instruccion>Usa esta información para responder la consulta del usuario de manera precisa.</instruccion>\n`;
      xml += `  </contexto_documentos>\n\n`;
    }

    // Available tools
    const toolNames = Object.keys(input.tools);
    if (toolNames.length > 0) {
      xml += `  <herramientas_disponibles>\n`;
      xml += `    <nota>Puedes usar estas herramientas para obtener información</nota>\n`;
      xml += `    <lista>${toolNames.join(', ')}</lista>\n`;
      xml += `  </herramientas_disponibles>\n\n`;
    }

    // Formatting instructions
    xml += `  <formato_respuesta>\n`;
    xml += `    <instruccion>Responde de forma natural y conversacional</instruccion>\n`;
    xml += `    <instruccion>Para imágenes usa formato Markdown: ![descripción](url)</instruccion>\n`;
    xml += `    <instruccion>Mantén el mensaje conciso pero completo</instruccion>\n`;
    xml += `    <instruccion>NO menciones que eres un "asistente virtual" ni uses lenguaje robótico</instruccion>\n`;
    xml += `  </formato_respuesta>\n\n`;

    xml += `</direct_writer>`;

    return xml;
  }

  /**
   * Execute the direct writer agent
   * Handles tool calls in a loop until maxSteps or no more tools needed
   */
  async execute(input: DirectWriterInput): Promise<DirectWriterOutput> {
    const startTime = Date.now();
    console.log('\n[DirectWriterAgent] ========== EXECUTION START ==========');
    console.log(`[DirectWriterAgent] User message: ${input.userMessage.substring(0, 100)}...`);
    console.log(`[DirectWriterAgent] Active guidelines: ${input.activeGuidelines.map(g => g.guideline.id).join(', ')}`);
    console.log(`[DirectWriterAgent] Available tools: ${Object.keys(input.tools).join(', ')}`);

    const systemPrompt = this.buildSystemPrompt(input);
    const toolsExecuted: DirectWriterOutput['toolsExecuted'] = [];
    
    let currentToolResults: Array<{ toolName: string; result: any }> = [];
    let finalResponse = '';
    let lastTextResponse = '';
    let iteration = 0;

    while (iteration < 1) {
      iteration++;
      console.log(`\n[DirectWriterAgent] Iteration ${iteration}/${this.config.maxSteps}`);

      // Build messages with tool results from previous iterations
      let messagesWithToolResults = [...input.messages];
      
      // If we have tool results from previous iterations, add them to context
      if (currentToolResults.length > 0) {
        const toolResultsContent = currentToolResults
          .map(tr => `[Tool ${tr.toolName}]: ${typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)}`)
          .join('\n\n');
        
        messagesWithToolResults.push({
          role: 'assistant',
          content: `He ejecutado las siguientes herramientas:\n${toolResultsContent}`
        });
        messagesWithToolResults.push({
          role: 'user',
          content: 'Por favor, usa la información de las herramientas para responder mi consulta original.'
        });
      }

      const toolNames = Object.keys(input.tools);

      try {
        const response = await generateText({
          model: this.model,
          system: systemPrompt,
          messages: messagesWithToolResults,
          tools: toolNames.length > 0 ? input.tools : undefined,
          maxOutputTokens: this.config.maxTokens,
          temperature: this.config.temperature,
          stopWhen: stepCountIs(toolNames.length + (toolNames.length > 0 ? 2 : 0))
        });

        console.log(`[DirectWriterAgent] Response text length: ${response.text?.length || 0}`);
        console.log(`[DirectWriterAgent] Tool calls: ${response.toolCalls?.length || 0}`);

        // Store text response
        if (response.text) {
          lastTextResponse = response.text;
        }
      } catch (error) {
        console.error('[DirectWriterAgent] Error in generateText:', error);
        throw error;
      }
    }

    // If we exhausted iterations without a final response, use last text
    if (!finalResponse) {
      if (lastTextResponse) {
        console.warn('[DirectWriterAgent] Max iterations reached, using last text response');
        finalResponse = lastTextResponse;
      } else {
        console.warn('[DirectWriterAgent] No response generated, using fallback');
        finalResponse = 'Disculpa, tuve un problema procesando tu solicitud. ¿Podrías intentarlo de nuevo?';
      }
    }

    const executionTimeMs = Date.now() - startTime;
    console.log(`\n[DirectWriterAgent] ========== EXECUTION END (${executionTimeMs}ms) ==========`);
    console.log(`[DirectWriterAgent] Tools executed: ${toolsExecuted.length}`);
    console.log(`[DirectWriterAgent] Iterations: ${iteration}`);
    console.log(`[DirectWriterAgent] Response length: ${finalResponse.length}`);

    return {
      response: finalResponse,
      toolsExecuted,
      metadata: {
        iterations: iteration,
        executionTimeMs
      }
    };
  }
}

