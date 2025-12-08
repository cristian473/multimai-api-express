/**
 * Support Worker
 * Handles escalation to human agents and sensitive topics
 * Uses tools: get_help
 */

import { BaseWorker, WorkerIterationResult } from './base-worker';
import { WORKER_REGISTRY, WorkerExecutionContext } from '../types';
import type { GuidelineAgent } from '../../guideline-agent';
import {
  getHelpTool,
  searchContextTool,
  createReminderTool,
} from '../../tools';

export class SupportWorker extends BaseWorker {
  constructor() {
    const definition = WORKER_REGISTRY.find(w => w.id === 'support_worker');
    if (!definition) {
      throw new Error('Support worker definition not found in registry');
    }
    super(definition);
  }

  protected async executeIteration(
    context: WorkerExecutionContext,
    previousFeedback?: string
  ): Promise<WorkerIterationResult> {
    console.log(`[SupportWorker] Executing iteration...`);

    // Build prompt
    let prompt = this.buildBasePrompt(context);

    // Add feedback if retrying
    if (previousFeedback) {
      prompt = this.addFeedbackToPrompt(prompt, previousFeedback);
    }

    // Add specific instructions for support/escalation
    prompt = prompt.replace('</worker_prompt>', '');
    prompt += `  <instrucciones_especificas>\n`;
    prompt += `    <reglas_criticas>\n`;
    prompt += `      <regla>SIEMPRE ejecutar get_help para temas sensibles</regla>\n`;
    prompt += `      <regla>NUNCA responder temas de negociación/precio sin escalar</regla>\n`;
    prompt += `      <regla>NUNCA inventar políticas de mascotas, garantías, etc.</regla>\n`;
    prompt += `    </reglas_criticas>\n`;
    prompt += `    <temas_obligatorio_escalar>\n`;
    prompt += `      <tema>Política de mascotas</tema>\n`;
    prompt += `      <tema>Negociación de precios</tema>\n`;
    prompt += `      <tema>Condiciones especiales de contrato</tema>\n`;
    prompt += `      <tema>Modificaciones a la propiedad</tema>\n`;
    prompt += `      <tema>Requisitos de garantía especiales</tema>\n`;
    prompt += `      <tema>Cuando el usuario dice "habla/contacta con el dueño"</tema>\n`;
    prompt += `    </temas_obligatorio_escalar>\n`;
    prompt += `    <formato_respuesta>\n`;
    prompt += `      <paso>1. Ejecutar get_help con el tema específico</paso>\n`;
    prompt += `      <paso>2. Informar al usuario: "Te consulto con el dueño sobre [tema] y te aviso ✓"</paso>\n`;
    prompt += `      <paso>3. NO dar respuesta genérica sin ejecutar get_help</paso>\n`;
    prompt += `    </formato_respuesta>\n`;
    prompt += `  </instrucciones_especificas>\n\n`;
    prompt += `</worker_prompt>`;

    // Get tools from guideline agent if available
    let guidelineTools: Record<string, any> = {};
    if (this.guidelineAgent) {
      const orchestrator = (this.guidelineAgent as any).orchestrator;
      if (orchestrator) {
        const relevantGuidelines = context.activeGuidelines.filter(g =>
          this.definition.associatedGuidelineIds.includes(g.guideline.id)
        );
        guidelineTools = orchestrator.getToolsForGuidelines(relevantGuidelines) || {};
      }
    }

    // Create support-related tools
    const { uid, userPhone, userName = 'Cliente' } = context;
    const supportTools: Record<string, any> = {
      get_help: getHelpTool(uid, userPhone, userName),
      search_context: searchContextTool(uid, userPhone),
      create_reminder: createReminderTool(uid, userPhone, userName),
    };

    // Merge tools: guideline tools take precedence, support tools fill in gaps
    const tools = {
      ...supportTools,
      ...guidelineTools, // Guidelines override if same tool exists
    };

    // Generate response
    const result = await this.generateWithModel(prompt, context, tools);

    // Extract tool calls from all steps (handles multi-step execution)
    const toolsExecuted = this.extractToolCalls(result);

    // Get response text
    const responseText = typeof result.text === 'string' ? result.text : await result.text;

    // Critical validation: get_help MUST be executed for escalation
    const getHelpExecuted = toolsExecuted.some(t => t.toolName === 'get_help');
    if (!getHelpExecuted) {
      console.warn(`[SupportWorker] ⚠️ get_help was NOT executed - this may fail validation`);
    }

    console.log(`[SupportWorker] Generated response with ${toolsExecuted.length} tool calls`);

    return {
      response: responseText,
      toolsExecuted
    };
  }
}

/**
 * Factory function to create support worker
 */
export function createSupportWorker(guidelineAgent?: GuidelineAgent): SupportWorker {
  const worker = new SupportWorker();
  if (guidelineAgent) {
    worker.setGuidelineAgent(guidelineAgent);
  }
  return worker;
}

