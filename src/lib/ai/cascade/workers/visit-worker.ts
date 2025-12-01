/**
 * Visit Worker
 * Handles visit scheduling, cancellation, and rescheduling
 * Uses tools: get_availability, create_visit, add_visitor, cancel_visit, reschedule_visit, ask_availability, get_visit_status
 */

import { BaseWorker, WorkerIterationResult } from './base-worker';
import { WORKER_REGISTRY, WorkerExecutionContext } from '../types';
import type { GuidelineAgent } from '../../guideline-agent';

export class VisitWorker extends BaseWorker {
  constructor() {
    const definition = WORKER_REGISTRY.find(w => w.id === 'visit_worker');
    if (!definition) {
      throw new Error('Visit worker definition not found in registry');
    }
    super(definition);
  }

  protected async executeIteration(
    context: WorkerExecutionContext,
    previousFeedback?: string
  ): Promise<WorkerIterationResult> {
    console.log(`[VisitWorker] Executing iteration...`);

    // Build prompt
    let prompt = this.buildBasePrompt(context);

    // Add feedback if retrying
    if (previousFeedback) {
      prompt = this.addFeedbackToPrompt(prompt, previousFeedback);
    }

    // Add specific instructions for visit management
    prompt = prompt.replace('</worker_prompt>', '');
    prompt += `  <instrucciones_especificas>\n`;
    prompt += `    <reglas_criticas>\n`;
    prompt += `      <regla>NUNCA crear visita sin property_id, fecha Y hora confirmados</regla>\n`;
    prompt += `      <regla>SIEMPRE consultar disponibilidad ANTES de crear visita</regla>\n`;
    prompt += `      <regla>Si hay slot existente que coincide, usar add_visitor NO create_visit</regla>\n`;
    prompt += `      <regla>Para horarios nuevos, PRIMERO ask_availability al dueño</regla>\n`;
    prompt += `      <regla>ESPERAR confirmación del usuario DESPUÉS de que el dueño confirme</regla>\n`;
    prompt += `    </reglas_criticas>\n`;
    prompt += `    <flujo_correcto>\n`;
    prompt += `      <paso>1. Usuario quiere agendar → verificar datos (property_id, fecha, hora)</paso>\n`;
    prompt += `      <paso>2. Si faltan datos → preguntar explícitamente</paso>\n`;
    prompt += `      <paso>3. Con datos completos → get_availability para ver slots</paso>\n`;
    prompt += `      <paso>4. Si hay slot coincidente → add_visitor</paso>\n`;
    prompt += `      <paso>5. Si NO hay slot → ask_availability al dueño</paso>\n`;
    prompt += `      <paso>6. Dueño confirma → notificar usuario y pedir confirmación</paso>\n`;
    prompt += `      <paso>7. Usuario confirma → create_visit</paso>\n`;
    prompt += `    </flujo_correcto>\n`;
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

    console.log(`[VisitWorker] Generated response with ${toolsExecuted.length} tool calls`);

    console.log('[VisitWorker] Response text:', responseText);
    return {
      response: responseText,
      toolsExecuted
    };
  }
}

/**
 * Factory function to create visit worker
 */
export function createVisitWorker(guidelineAgent?: GuidelineAgent): VisitWorker {
  const worker = new VisitWorker();
  if (guidelineAgent) {
    worker.setGuidelineAgent(guidelineAgent);
  }
  return worker;
}

