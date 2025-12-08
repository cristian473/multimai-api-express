/**
 * Search Worker
 * Handles property search and information retrieval
 * Uses tools: search_properties, get_property_info
 */

import { BaseWorker, WorkerIterationResult } from './base-worker';
import { WORKER_REGISTRY, WorkerExecutionContext } from '../types';
import type { GuidelineAgent } from '../../guideline-agent';
import {
  searchPropertiesRAGTool,
  getPropertyInfoTool,
} from '../../tools';

export class SearchWorker extends BaseWorker {
  constructor() {
    const definition = WORKER_REGISTRY.find(w => w.id === 'search_worker');
    if (!definition) {
      throw new Error('Search worker definition not found in registry');
    }
    super(definition);
  }

  protected async executeIteration(
    context: WorkerExecutionContext,
    previousFeedback?: string
  ): Promise<WorkerIterationResult> {
    console.log(`[SearchWorker] Executing iteration...`);

    // Build prompt
    let prompt = this.buildBasePrompt(context);

    // Add feedback if retrying
    if (previousFeedback) {
      prompt = this.addFeedbackToPrompt(prompt, previousFeedback);
    }

    // Add specific instructions for search
    prompt = prompt.replace('</worker_prompt>', '');
    prompt += `  <instrucciones_especificas>\n`;
    prompt += `    <instruccion>Para búsquedas, SIEMPRE usa search_properties con los filtros apropiados</instruccion>\n`;
    prompt += `    <instruccion>Incluye TODOS los criterios mencionados por el usuario (precio, tipo, ubicación, dormitorios)</instruccion>\n`;
    prompt += `    <instruccion>Las imágenes DEBEN estar en formato Markdown: ![descripción](url)</instruccion>\n`;
    prompt += `    <instruccion>Si no hay resultados, sugiere alternativas relajando criterios</instruccion>\n`;
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

    // Create search-related tools
    const { uid, userPhone } = context;
    const searchTools: Record<string, any> = {
      search_properties_rag: searchPropertiesRAGTool(uid, userPhone),
      get_property_info: getPropertyInfoTool(uid),
    };

    // Merge tools: guideline tools take precedence, search tools fill in gaps
    const tools = {
      ...searchTools,
      ...guidelineTools, // Guidelines override if same tool exists
    };

    // Generate response
    const result = await this.generateWithModel(prompt, context, tools);

    // Extract tool calls from all steps (handles multi-step execution)
    const toolsExecuted = this.extractToolCalls(result);

    // Get response text
    const responseText = typeof result.text === 'string' ? result.text : await result.text;

    console.log(`[SearchWorker] Generated response with ${toolsExecuted.length} tool calls`);

    console.log('[SearchWorker] Response text:', responseText);

    return {
      response: responseText,
      toolsExecuted
    };
  }
}

/**
 * Factory function to create search worker
 */
export function createSearchWorker(guidelineAgent?: GuidelineAgent): SearchWorker {
  const worker = new SearchWorker();
  if (guidelineAgent) {
    worker.setGuidelineAgent(guidelineAgent);
  }
  return worker;
}

