/**
 * Feedback Worker
 * Handles feedback collection and logging
 * Uses tools: log_feedback
 */

import { BaseWorker, WorkerIterationResult } from './base-worker';
import { WORKER_REGISTRY, WorkerExecutionContext } from '../types';
import type { GuidelineAgent } from '../../guideline-agent';

export class FeedbackWorker extends BaseWorker {
  constructor() {
    const definition = WORKER_REGISTRY.find(w => w.id === 'feedback_worker');
    if (!definition) {
      throw new Error('Feedback worker definition not found in registry');
    }
    super(definition);
  }

  protected async executeIteration(
    context: WorkerExecutionContext,
    previousFeedback?: string
  ): Promise<WorkerIterationResult> {
    console.log(`[FeedbackWorker] Executing iteration...`);

    // Build prompt
    let prompt = this.buildBasePrompt(context);

    // Add feedback if retrying
    if (previousFeedback) {
      prompt = this.addFeedbackToPrompt(prompt, previousFeedback);
    }

    // Add specific instructions for feedback collection
    prompt = prompt.replace('</worker_prompt>', '');
    prompt += `  <instrucciones_especificas>\n`;
    prompt += `    <reglas_criticas>\n`;
    prompt += `      <regla>SIEMPRE ejecutar log_feedback para guardar el feedback del usuario</regla>\n`;
    prompt += `      <regla>Extraer la calificación numérica (1-10) del mensaje del usuario</regla>\n`;
    prompt += `      <regla>Extraer el mensaje/comentario textual del feedback</regla>\n`;
    prompt += `      <regla>NUNCA inventar feedback que el usuario no haya proporcionado</regla>\n`;
    prompt += `    </reglas_criticas>\n`;
    prompt += `    <parametros_log_feedback>\n`;
    prompt += `      <parametro name="rating">Número del 1 al 10 indicando satisfacción</parametro>\n`;
    prompt += `      <parametro name="message">Texto literal del comentario del usuario</parametro>\n`;
    prompt += `    </parametros_log_feedback>\n`;
    prompt += `    <formato_respuesta>\n`;
    prompt += `      <paso>1. Ejecutar log_feedback con rating y message extraídos</paso>\n`;
    prompt += `      <paso>2. Agradecer al usuario por su feedback</paso>\n`;
    prompt += `      <paso>3. Indicar que su opinión es valiosa para mejorar</paso>\n`;
    prompt += `    </formato_respuesta>\n`;
    prompt += `  </instrucciones_especificas>\n\n`;
    prompt += `</worker_prompt>`;

    // Get tools from guideline agent if available
    let tools: any = undefined;
    if (this.guidelineAgent) {
      const orchestrator = (this.guidelineAgent as any).orchestrator;
      if (orchestrator) {
        const relevantGuidelines = context.activeGuidelines.filter(g =>
          this.definition.associatedGuidelineIds.includes(g.guideline.id)
        );
        tools = orchestrator.getToolsForGuidelines(relevantGuidelines);
      }
    }

    // Generate response
    const result = await this.generateWithModel(prompt, context, tools);

    // Extract tool calls from all steps (handles multi-step execution)
    const toolsExecuted = this.extractToolCalls(result);

    // Get response text
    const responseText = typeof result.text === 'string' ? result.text : await result.text;

    // Critical validation: log_feedback MUST be executed
    const logFeedbackExecuted = toolsExecuted.some(t => t.toolName === 'log_feedback');
    if (!logFeedbackExecuted) {
      console.warn(`[FeedbackWorker] ⚠️ log_feedback was NOT executed - this may fail validation`);
    }

    console.log(`[FeedbackWorker] Generated response with ${toolsExecuted.length} tool calls`);

    return {
      response: responseText,
      toolsExecuted
    };
  }
}

/**
 * Factory function to create feedback worker
 */
export function createFeedbackWorker(guidelineAgent?: GuidelineAgent): FeedbackWorker {
  const worker = new FeedbackWorker();
  if (guidelineAgent) {
    worker.setGuidelineAgent(guidelineAgent);
  }
  return worker;
}

