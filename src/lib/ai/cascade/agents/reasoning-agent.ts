/**
 * ReasoningAgent - Handles internal analysis, deduction, and interpretation tasks
 * 
 * This agent processes 'reasoning' type tasks that don't require external tools.
 * It analyzes context, makes deductions, and provides structured reasoning output.
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { PlanTask, ActionPlan } from '../types';
import type { GuidelineMatch } from '../../types/guideline';
import type { LLMMessage } from '../../context/conversation-loader';
import { AI_CONFIG } from '../../config';
import { getModel } from '../../openrouter';

export interface ReasoningInput {
  task: PlanTask;
  userMessage: string;
  messages: LLMMessage[];
  activeGuidelines: GuidelineMatch[];
  previousTaskResults: Map<string, string>;
  planContext?: ActionPlan;
}

export interface ReasoningOutput {
  taskId: string;
  success: boolean;
  reasoning: string;       // The actual reasoning/analysis
  conclusion: string;      // Key conclusion or finding
  extractedData?: Record<string, any>;  // Any structured data extracted
  confidence: number;      // Confidence level 0-1
  error?: string;
}

export class ReasoningAgent {
  private model;

  constructor() {
    this.model = getModel(AI_CONFIG?.CASCADE?.REASONING_MODEL, { reasoning: { enabled: true, effort: 'medium' }});
  }

  /**
   * Execute reasoning task
   */
  async execute(input: ReasoningInput): Promise<ReasoningOutput> {
    console.log(`[ReasoningAgent] Processing task: ${input.task.id}`);
    console.log(`[ReasoningAgent] Description: ${input.task.description}`);

    try {
      const prompt = this.buildPrompt(input);
      
      const result = await generateText({
        model: this.model,
        system: prompt,
        prompt: 'Realiza el análisis y razonamiento solicitado.',
        temperature: 0.3
      });

      // Parse the response to extract structured data
      const parsed = this.parseResponse(result.text);

      console.log(`[ReasoningAgent] Task ${input.task.id} completed`);
      console.log(`[ReasoningAgent] Conclusion: ${parsed.conclusion}`);

      return {
        taskId: input.task.id,
        success: true,
        reasoning: parsed.reasoning,
        conclusion: parsed.conclusion,
        extractedData: parsed.extractedData,
        confidence: parsed.confidence
      };

    } catch (error) {
      console.error(`[ReasoningAgent] Error in task ${input.task.id}:`, error);
      return {
        taskId: input.task.id,
        success: false,
        reasoning: '',
        conclusion: '',
        confidence: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Build the reasoning prompt
   */
  private buildPrompt(input: ReasoningInput): string {
    let prompt = `<reasoning_agent>\n\n`;

    prompt += `  <role>\n`;
    prompt += `    <descripcion>Eres un agente de razonamiento y análisis</descripcion>\n`;
    prompt += `    <objetivo>Analizar información, hacer deducciones y extraer conclusiones</objetivo>\n`;
    prompt += `  </role>\n\n`;

    prompt += `  <tarea>\n`;
    prompt += `    <id>${input.task.id}</id>\n`;
    prompt += `    <paso>${input.task.step}</paso>\n`;
    prompt += `    <descripcion>${input.task.description}</descripcion>\n`;
    prompt += `  </tarea>\n\n`;

    prompt += `  <mensaje_usuario>\n`;
    prompt += `    <contenido>${input.userMessage}</contenido>\n`;
    prompt += `  </mensaje_usuario>\n\n`;

    // // Conversation context
    // if (input.conversationContext.messages && input.conversationContext.messages.length > 0) {
    //   prompt += `  <historial_conversacion>\n`;
    //   input.conversationContext.messages.slice(-10).forEach((msg, i) => {
    //     prompt += `    <mensaje index="${i}" rol="${msg.role}">${msg.content}</mensaje>\n`;
    //   });
    //   prompt += `  </historial_conversacion>\n\n`;
    // }

    // Previous task results
    if (input.previousTaskResults.size > 0) {
      prompt += `  <resultados_tareas_previas>\n`;
      input.previousTaskResults.forEach((result, taskId) => {
        prompt += `    <resultado task_id="${taskId}">\n`;
        prompt += `      ${result}\n`;
        prompt += `    </resultado>\n`;
      });
      prompt += `  </resultados_tareas_previas>\n\n`;
    }

    // // Context variables (from metadata)
    // if (input.planContext?.metadata && Object.keys(input.planContext.metadata).length > 0) {
    //   const vars = input.planContext?.metadata as Record<string, any>;
    //   prompt += `  <variables_contexto>\n`;
    //   Object.entries(vars).forEach(([key, value]) => {
    //     if (value !== undefined && value !== null) {
    //       prompt += `    <variable nombre="${key}">${JSON.stringify(value)}</variable>\n`;
    //     }
    //   });
    //   prompt += `  </variables_contexto>\n\n`;
    // }

    prompt += `  <instrucciones>\n`;
    prompt += `    <instruccion>Analiza cuidadosamente la información disponible</instruccion>\n`;
    prompt += `    <instruccion>Responde en formato estructurado con secciones RAZONAMIENTO, CONCLUSION, y DATOS_EXTRAIDOS</instruccion>\n`;
    prompt += `    <instruccion>Si extraes datos específicos (IDs, fechas, nombres), inclúyelos en DATOS_EXTRAIDOS</instruccion>\n`;
    prompt += `    <instruccion>Indica tu nivel de confianza (0.0 a 1.0) en CONFIANZA</instruccion>\n`;
    prompt += `  </instrucciones>\n\n`;

    prompt += `  <formato_respuesta>\n`;
    prompt += `    RAZONAMIENTO:\n`;
    prompt += `    [Tu análisis paso a paso]\n\n`;
    prompt += `    CONCLUSION:\n`;
    prompt += `    [Conclusión principal]\n\n`;
    prompt += `    DATOS_EXTRAIDOS:\n`;
    prompt += `    key1: value1\n`;
    prompt += `    key2: value2\n\n`;
    prompt += `    CONFIANZA: 0.X\n`;
    prompt += `  </formato_respuesta>\n\n`;

    prompt += `</reasoning_agent>`;

    return prompt;
  }

  /**
   * Parse the LLM response into structured output
   */
  private parseResponse(text: string): {
    reasoning: string;
    conclusion: string;
    extractedData: Record<string, any>;
    confidence: number;
  } {
    let reasoning = '';
    let conclusion = '';
    const extractedData: Record<string, any> = {};
    let confidence = 0.5;

    // Extract RAZONAMIENTO section
    const reasoningMatch = text.match(/RAZONAMIENTO:\s*([\s\S]*?)(?=CONCLUSION:|DATOS_EXTRAIDOS:|CONFIANZA:|$)/i);
    if (reasoningMatch) {
      reasoning = reasoningMatch[1].trim();
    }

    // Extract CONCLUSION section
    const conclusionMatch = text.match(/CONCLUSION:\s*([\s\S]*?)(?=DATOS_EXTRAIDOS:|CONFIANZA:|$)/i);
    if (conclusionMatch) {
      conclusion = conclusionMatch[1].trim();
    }

    // Extract DATOS_EXTRAIDOS section
    const dataMatch = text.match(/DATOS_EXTRAIDOS:\s*([\s\S]*?)(?=CONFIANZA:|$)/i);
    if (dataMatch) {
      const dataLines = dataMatch[1].trim().split('\n');
      dataLines.forEach(line => {
        const kvMatch = line.match(/^(\w+):\s*(.+)$/);
        if (kvMatch) {
          const key = kvMatch[1].trim();
          let value: any = kvMatch[2].trim();
          
          // Try to parse as number or boolean
          if (!isNaN(Number(value))) {
            value = Number(value);
          } else if (value.toLowerCase() === 'true') {
            value = true;
          } else if (value.toLowerCase() === 'false') {
            value = false;
          }
          
          extractedData[key] = value;
        }
      });
    }

    // Extract CONFIANZA
    const confidenceMatch = text.match(/CONFIANZA:\s*([\d.]+)/i);
    if (confidenceMatch) {
      confidence = parseFloat(confidenceMatch[1]);
      if (isNaN(confidence) || confidence < 0 || confidence > 1) {
        confidence = 0.5;
      }
    }

    // Fallback if no structured format found
    if (!reasoning && !conclusion) {
      reasoning = text;
      conclusion = text.split('\n')[0] || text.substring(0, 200);
    }

    return { reasoning, conclusion, extractedData, confidence };
  }
}

