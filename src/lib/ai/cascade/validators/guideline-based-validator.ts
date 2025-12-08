/**
 * Lightweight Validator
 * Simple validator that checks tool parameters and returns score + feedback
 * Workers return truthful data, so we only validate parameter correctness
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { getModel } from '../../openrouter';
import { AI_CONFIG } from '../../config';
import type { WorkerExecutionContext, LightweightValidationResult } from '../types';
import type { WorkerToolResult } from '../workers/base-worker';

// Schema for the lightweight validation result
// Note: All fields must be required for Azure/OpenAI JSON Schema compatibility
const LightweightValidationSchema = z.object({
  score: z.number().min(0).max(10).describe('Score from 0-10. 7+ means execution was correct.'),
  feedback: z.string().describe('If score < 7, describe which tool to execute and with what parameters. Example: "Ejecutar search_properties con { precio_max: 500000, dormitorios: 3 }". Use empty string if no feedback needed.')
});

export interface LightweightValidatorConfig {
  workerId: string;
  threshold: number;
}

export interface ToolSchema {
  description: string;
  parameters: string;
}

const DEFAULT_THRESHOLD = 7.0;

/**
 * Lightweight validator that only checks tool parameters
 */
export class LightweightValidator {
  private config: LightweightValidatorConfig;
  private model: ReturnType<typeof getModel>;

  constructor(config: LightweightValidatorConfig) {
    this.config = config;
    this.model = getModel(AI_CONFIG?.CASCADE?.VALIDATOR_MODEL ?? 'openai/gpt-4o-mini');
  }

  /**
   * Build a minimal prompt for parameter validation
   */
  private buildMinimalPrompt(
    userMessage: string,
    toolsExecuted: WorkerToolResult[],
    toolSchemas?: Record<string, ToolSchema>
  ): string {
    let prompt = `Eres un validador de ejecución de herramientas. Tu trabajo es verificar si las herramientas se ejecutaron correctamente.\n\n`;

    prompt += `=== MENSAJE DEL USUARIO ===\n`;
    prompt += `"${userMessage}"\n\n`;

    // Include tool schemas if available
    if (toolSchemas && Object.keys(toolSchemas).length > 0) {
      prompt += `=== ESQUEMA DE HERRAMIENTAS DISPONIBLES ===\n`;
      
      for (const [toolName, schema] of Object.entries(toolSchemas)) {
        prompt += `📦 ${toolName}\n`;
        prompt += `   ${schema.description}\n`;
        if (schema.parameters && schema.parameters !== 'Sin parámetros definidos') {
          prompt += `   Parámetros:\n${schema.parameters}\n`;
        }
        prompt += `\n`;
      }
    }

    if (toolsExecuted.length > 0) {
      prompt += `=== HERRAMIENTAS EJECUTADAS ===\n`;
      toolsExecuted.forEach((tool, idx) => {
        prompt += `${idx + 1}. ${tool.toolName}\n`;
        
        // Show arguments
        const argsStr = JSON.stringify(tool.args ?? {});
        prompt += `   Argumentos: ${argsStr}\n`;
        
        // Include the result to help validator understand if execution was successful
        if (tool.result !== undefined) {
          const resultStr = typeof tool.result === 'string' 
            ? tool.result 
            : JSON.stringify(tool.result);
          const truncatedResult = resultStr.length > 300 
            ? resultStr.substring(0, 300) + '...' 
            : resultStr;
          prompt += `   Resultado: ${truncatedResult}\n`;
        }
        prompt += `\n`;
      });
    } else {
      prompt += `=== NO SE EJECUTARON HERRAMIENTAS ===\n`;
    }

    prompt += `=== REGLAS DE VALIDACIÓN ===\n`;
    prompt += `CRÍTICO: Si el resultado contiene "success":true, la ejecución fue EXITOSA.\n\n`;
    prompt += `Score 9-10: Herramienta ejecutada con éxito (success:true) + parámetros correctos\n`;
    prompt += `Score 7-8: Herramienta ejecutada con éxito pero parámetros podrían mejorarse\n`;
    prompt += `Score 4-6: Discrepancias significativas en parámetros\n`;
    prompt += `Score 0-3: Herramienta falló (success:false) o parámetros incorrectos\n\n`;
    prompt += `Si score < 7, indica en feedback qué herramienta ejecutar con qué parámetros.\n`;

    return prompt;
  }

  /**
   * Main validation method - lightweight and fast
   * @param toolSchemas - Optional tool schemas to help validator understand parameter formats
   */
  async validate(
    response: string,
    context: WorkerExecutionContext,
    toolsExecuted: WorkerToolResult[],
    toolSchemas?: Record<string, ToolSchema>
  ): Promise<LightweightValidationResult> {
    console.log(`[LightweightValidator:${this.config.workerId}] Validating...`);
    console.log(`[LightweightValidator:${this.config.workerId}] Tools: ${toolsExecuted.map(t => t.toolName).join(', ') || 'none'}`);
    if (toolSchemas) {
      console.log(`[LightweightValidator:${this.config.workerId}] Tool schemas provided for: ${Object.keys(toolSchemas).join(', ')}`);
    }

    // If no tools were executed and none were needed, auto-pass
    if (toolsExecuted.length === 0) {
      console.log(`[LightweightValidator:${this.config.workerId}] No tools executed, auto-passing`);
      return {
        score: 8.0,
        isValid: true
      };
    }

    // Build minimal prompt with tool schemas
    const prompt = this.buildMinimalPrompt(context.userMessage, toolsExecuted, toolSchemas);

    // Log the prompt for debugging
    // console.log(`[LightweightValidator:${this.config.workerId}] Validation prompt:\n${prompt.substring(0, 500)}...`);

    // Quick LLM call with minimal tokens
    const result = await generateObject({
      model: this.model,
      schema: LightweightValidationSchema,
      prompt,
      maxOutputTokens: 300,
      temperature: 0.1
    });

    const { score, feedback } = result.object;
    const isValid = score >= this.config.threshold;
    // Convert empty string to undefined for type compatibility
    const normalizedFeedback = feedback && feedback.trim() ? feedback : undefined;

    console.log(`[LightweightValidator:${this.config.workerId}] Score: ${score}/10, Valid: ${isValid}`);
    if (normalizedFeedback) {
      console.log(`[LightweightValidator:${this.config.workerId}] Feedback: ${normalizedFeedback}`);
    }

    return {
      score,
      isValid,
      feedback: normalizedFeedback
    };
  }

  /**
   * Get the threshold for this validator
   */
  getThreshold(): number {
    return this.config.threshold;
  }
}

/**
 * Factory to create lightweight validators for each worker type
 */
export function createValidatorForWorker(
  workerId: string,
  _associatedGuidelineIds: string[], // Kept for API compatibility but not used
  threshold: number = DEFAULT_THRESHOLD
): LightweightValidator {
  return new LightweightValidator({
    workerId,
    threshold
  });
}

// Re-export for backwards compatibility
export { LightweightValidator as GuidelineBasedValidator };
