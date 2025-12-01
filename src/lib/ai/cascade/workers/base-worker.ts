/**
 * Base Worker
 * Abstract class for all cascade workers with lightweight validation
 * Single execution + optional 1 retry based on feedback
 */

import { generateText, stepCountIs } from 'ai';
import { getModel } from '../../openrouter';
import { AI_CONFIG } from '../../config';
import { LightweightValidator, createValidatorForWorker } from '../validators/guideline-based-validator';
import type { 
  WorkerDefinition, 
  WorkerResult, 
  WorkerExecutionContext, 
  WorkerStatus,
  LightweightValidationResult 
} from '../types';
import type { GuidelineAgent } from '../../guideline-agent';

export interface WorkerToolResult {
  toolName: string;
  args: Record<string, any>;
  result: any;
  timestamp: number;
}

export interface WorkerIterationResult {
  response: string;
  toolsExecuted: WorkerToolResult[];
}

/**
 * Abstract base class for all cascade workers
 */
export abstract class BaseWorker {
  protected definition: WorkerDefinition;
  protected validator: LightweightValidator;
  protected model: ReturnType<typeof getModel>;
  protected guidelineAgent?: GuidelineAgent;

  constructor(definition: WorkerDefinition) {
    this.definition = definition;
    
    // Create lightweight validator for this worker
    this.validator = createValidatorForWorker(
      definition.id,
      definition.associatedGuidelineIds,
      definition.validationThreshold
    );

    this.model = getModel(AI_CONFIG?.CASCADE?.WORKER_MODELS?.[this.definition.id] ?? 'openai/gpt-4o-mini');
  }

  /**
   * Set the guideline agent for tool access and schema retrieval
   */
  setGuidelineAgent(agent: GuidelineAgent): void {
    this.guidelineAgent = agent;
  }

  /**
   * Check if this worker should activate for the given context
   */
  shouldActivate(context: WorkerExecutionContext): boolean {
    if (!this.definition.enabled) return false;

    return context.activeGuidelines.some(g =>
      this.definition.associatedGuidelineIds.includes(g.guideline.id)
    );
  }

  /**
   * Execute the worker's main logic (single iteration)
   * Must be implemented by each specific worker
   */
  protected abstract executeIteration(
    context: WorkerExecutionContext,
    previousFeedback?: string
  ): Promise<WorkerIterationResult>;

  /**
   * Build the base prompt for this worker
   */
  protected buildBasePrompt(context: WorkerExecutionContext): string {
    let prompt = `<worker_prompt>\n\n`;

    prompt += `  <role>\n`;
    prompt += `    <nombre>${this.definition.name}</nombre>\n`;
    prompt += `    <descripcion>${this.definition.description}</descripcion>\n`;
    prompt += `    <worker_id>${this.definition.id}</worker_id>\n`;
    prompt += `  </role>\n\n`;

    prompt += `  <mensaje_usuario>\n`;
    prompt += `    <contenido>${context.userMessage}</contenido>\n`;
    prompt += `  </mensaje_usuario>\n\n`;

    // Task description from planner
    if (context.task.description && context.task.description.trim() !== '') {
      prompt += `  <tarea_asignada>\n`;
      prompt += `    <paso>${context.task.step}</paso>\n`;
      prompt += `    <descripcion>${context.task.description}</descripcion>\n`;
      prompt += `    <tipo>${context.task.type}</tipo>\n`;
      prompt += `    <nota>Esta es tu tarea específica. Complétala siguiendo las guidelines activas.</nota>\n`;
      prompt += `  </tarea_asignada>\n\n`;
    }

    // Previous task results if available
    if (context.previousTaskResults && context.previousTaskResults.size > 0) {
      prompt += `  <resultados_tareas_previas>\n`;
      context.previousTaskResults.forEach((result, taskId) => {
        prompt += `    <resultado task_id="${taskId}">${result}</resultado>\n`;
      });
      prompt += `  </resultados_tareas_previas>\n\n`;
    }

    // Active guidelines for this worker
    const relevantGuidelines = context.activeGuidelines.filter(g =>
      this.definition.associatedGuidelineIds.includes(g.guideline.id)
    );

    if (relevantGuidelines.length > 0) {
      prompt += `  <guidelines_activas>\n`;
      prompt += `    <nota>DEBES seguir estas guidelines estrictamente</nota>\n`;
      relevantGuidelines.forEach(match => {
        const g = match.guideline;
        prompt += `    <guideline id="${g.id}" score="${match.score.toFixed(2)}">\n`;
        prompt += `      <condicion>${g.condition}</condicion>\n`;
        prompt += `      <accion>${g.action}</accion>\n`;
        if (g.tools && g.tools.length > 0) {
          prompt += `      <herramientas_permitidas>${g.tools.join(', ')}</herramientas_permitidas>\n`;
        }
        prompt += `    </guideline>\n`;
      });
      prompt += `  </guidelines_activas>\n\n`;
    }

    // Available tools for this worker
    prompt += `  <herramientas_disponibles>\n`;
    this.definition.toolNames.forEach(toolName => {
      prompt += `    <herramienta>${toolName}</herramienta>\n`;
    });
    prompt += `  </herramientas_disponibles>\n\n`;

    // Context variables from workflow (fecha, nombre_usuario, nombre_negocio, etc.)
    if (context.contextVariables && Object.keys(context.contextVariables).length > 0) {
      prompt += `  <variables_contexto>\n`;
      prompt += `    <nota>Información contextual importante para tu respuesta</nota>\n`;
      for (const [key, value] of Object.entries(context.contextVariables)) {
        prompt += `    <variable nombre="${key}">${value}</variable>\n`;
      }
      prompt += `  </variables_contexto>\n\n`;
    }

    console.log(`[BaseWorker:${this.definition.id}] Prompt:`, prompt);

    return prompt;
  }

  /**
   * Add simple feedback to prompt for retry (lightweight version)
   */
  protected addFeedbackToPrompt(prompt: string, feedback: string): string {
    let feedbackPrompt = prompt;
    
    feedbackPrompt = feedbackPrompt.replace('</worker_prompt>', '');
    
    feedbackPrompt += `  <correccion_requerida>\n`;
    feedbackPrompt += `    <feedback>${feedback}</feedback>\n`;
    feedbackPrompt += `    <nota>DEBES aplicar esta corrección en tu respuesta</nota>\n`;
    feedbackPrompt += `  </correccion_requerida>\n\n`;
    feedbackPrompt += `</worker_prompt>`;
    
    return feedbackPrompt;
  }

  /**
   * Main execution method - single execution + optional 1 retry
   */
  async execute(context: WorkerExecutionContext): Promise<WorkerResult> {
    const startTime = Date.now();

    console.log(`[Worker:${this.definition.id}] Starting execution...`);

    // Check activation
    if (!this.shouldActivate(context)) {
      console.log(`[Worker:${this.definition.id}] Not activated for this context`);
      return this.createResult('success', '', [], { score: 10, isValid: true }, startTime, [], 0);
    }

    const activatedGuidelines = context.activeGuidelines
      .filter(g => this.definition.associatedGuidelineIds.includes(g.guideline.id))
      .map(g => g.guideline.id);

    console.log(`[Worker:${this.definition.id}] Activated with guidelines:`, activatedGuidelines);

    // Get tool schemas for validation if guidelineAgent is available
    const toolSchemas = this.guidelineAgent 
      ? this.guidelineAgent.getToolSchemas(this.definition.toolNames)
      : undefined;
    
    if (toolSchemas) {
      console.log(`[Worker:${this.definition.id}] Tool schemas loaded for validation: ${Object.keys(toolSchemas).join(', ')}`);
    }

    let lastResponse = '';
    let lastToolsExecuted: WorkerToolResult[] = [];
    let iterations = 0;

    try {
      // First execution
      iterations++;
      console.log(`[Worker:${this.definition.id}] Executing (attempt 1)...`);
      
      const result = await this.executeIteration(context);
      lastResponse = result.response;
      lastToolsExecuted = result.toolsExecuted;

      console.log('[BaseWorker] Response:', lastResponse?.substring(0, 200) + '...');
      console.log('[BaseWorker] Tools executed:', lastToolsExecuted.map(t => t.toolName));

      // Validate result with lightweight validator (with tool schemas for better feedback)
      const validation = await this.validator.validate(
        lastResponse,
        context,
        lastToolsExecuted,
        toolSchemas
      );

      console.log(`[Worker:${this.definition.id}] Validation score: ${validation.score}/10`);

      // If score >= 7, we're done - success!
      if (validation.isValid) {
        console.log(`[Worker:${this.definition.id}] ✓ Validation passed`);
        return this.createResult(
          'success',
          lastResponse,
          lastToolsExecuted,
          validation,
          startTime,
          activatedGuidelines,
          iterations
        );
      }

      // If score < 7, try ONE more time with feedback
      if (validation.feedback) {
        console.log(`[Worker:${this.definition.id}] Score < 7, retrying with feedback: ${validation.feedback}`);
        iterations++;

        const retryResult = await this.executeIteration(context, validation.feedback);
        lastResponse = retryResult.response;
        lastToolsExecuted = retryResult.toolsExecuted;

        // Validate again (with tool schemas)
        const retryValidation = await this.validator.validate(
          lastResponse,
          context,
          lastToolsExecuted,
          toolSchemas
        );

        console.log(`[Worker:${this.definition.id}] Retry validation score: ${retryValidation.score}/10`);

        // Return result - if we have a valid response, consider it success even with low score
        // The response can still be used by the writer even if validation didn't pass
        const hasValidResponse = lastResponse && lastResponse.trim().length > 0;
        return this.createResult(
          hasValidResponse ? 'success' : 'failed',
          lastResponse,
          lastToolsExecuted,
          retryValidation,
          startTime,
          activatedGuidelines,
          iterations
        );
      }

      // No feedback provided but score was low - still return success if we have a response
      // The writer can use the response even if validation score was low
      const hasValidResponse = lastResponse && lastResponse.trim().length > 0;
      return this.createResult(
        hasValidResponse ? 'success' : 'failed',
        lastResponse,
        lastToolsExecuted,
        validation,
        startTime,
        activatedGuidelines,
        iterations
      );

    } catch (error) {
      console.error(`[Worker:${this.definition.id}] Error during execution:`, error);
      
      // If we have a valid response from a previous iteration, use it even on error
      const hasValidResponse = lastResponse && lastResponse.trim().length > 0;
      
      return this.createResult(
        hasValidResponse ? 'success' : 'failed',
        lastResponse,
        lastToolsExecuted,
        { 
          score: hasValidResponse ? 5 : 0, // Give partial score if we have a response
          isValid: hasValidResponse, 
          feedback: error instanceof Error ? error.message : String(error)
        },
        startTime,
        activatedGuidelines,
        iterations,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Create the result object
   */
  private createResult(
    status: WorkerStatus,
    response: string,
    toolsExecuted: WorkerToolResult[],
    validation: LightweightValidationResult,
    startTime: number,
    activatedGuidelines: string[],
    iterations: number = 0,
    error?: string
  ): WorkerResult {
    return {
      workerId: this.definition.id,
      status,
      response,
      toolsExecuted,
      validation: {
        passed: validation.isValid,
        score: validation.score,
        iterations,
        feedback: validation.feedback,
        guidelinesCriteria: this.definition.associatedGuidelineIds
      },
      metadata: {
        executionTimeMs: Date.now() - startTime,
        activatedGuidelines
      },
      error
    };
  }

  /**
   * Helper to execute model generation
   * Uses stepCountIs(1) to ensure only one tool execution per iteration
   * This prevents duplicate tool calls (e.g., get_availability being called 3 times)
   */
  protected async generateWithModel(
    systemPrompt: string,
    context: WorkerExecutionContext,
    tools?: any,
    maxSteps?: number
  ): Promise<any> {
    return await generateText({
      model: this.model,
      system: systemPrompt,
      messages: context.messages,
      tools,
      maxOutputTokens: 2000,
      temperature: 0.7,
      stopWhen: stepCountIs(maxSteps ?? 2) // Single step to avoid duplicate tool executions
    });
  }

  /**
   * Extract all tool calls from generateText result
   * Handles both single-step and multi-step results (when using stopWhen)
   */
  protected extractToolCalls(result: any): WorkerToolResult[] {
    const toolsExecuted: WorkerToolResult[] = [];
    const seenToolCallIds = new Set<string>();

    // Build a map of all tool results for easy lookup
    const toolResultsMap = new Map<string, { output: any; input: any }>();
    
    // Collect results from steps
    if (result.steps && Array.isArray(result.steps)) {
      for (const step of result.steps) {
        if (step.toolResults && Array.isArray(step.toolResults)) {
          for (const tr of step.toolResults) {
            if (tr.toolCallId) {
              toolResultsMap.set(tr.toolCallId, {
                output: tr.output,
                input: tr.input
              });
            }
          }
        }
      }
    }
    
    // Collect results from direct toolResults
    if (result.toolResults && Array.isArray(result.toolResults)) {
      for (const tr of result.toolResults) {
        if (tr.toolCallId) {
          toolResultsMap.set(tr.toolCallId, {
            output: tr.output,
            input: tr.input
          });
        }
      }
    }

    // Helper to add a tool call avoiding duplicates
    const addToolCall = (toolCall: any) => {
      if (!toolCall.toolCallId || seenToolCallIds.has(toolCall.toolCallId)) return;
      seenToolCallIds.add(toolCall.toolCallId);

      const toolData = toolResultsMap.get(toolCall.toolCallId);
      
      // Parse output if it's a string (JSON)
      let parsedOutput = toolData?.output;
      if (typeof parsedOutput === 'string') {
        try {
          parsedOutput = JSON.parse(parsedOutput);
        } catch {
          // Keep as string if not valid JSON
        }
      }

      const args = toolCall.args ?? toolData?.input ?? {};

      toolsExecuted.push({
        toolName: toolCall.toolName,
        args,
        result: parsedOutput,
        timestamp: Date.now()
      });
      
      console.log(`[BaseWorker] Tool extracted: ${toolCall.toolName}, hasResult: ${parsedOutput !== undefined}`);
    };

    // Extract from steps (multi-step execution)
    if (result.steps && Array.isArray(result.steps)) {
      for (const step of result.steps) {
        if (step.toolCalls && Array.isArray(step.toolCalls)) {
          for (const toolCall of step.toolCalls) {
            addToolCall(toolCall);
          }
        }
      }
    }

    // Extract from direct toolCalls (single-step or last step)
    if (result.toolCalls && Array.isArray(result.toolCalls)) {
      for (const toolCall of result.toolCalls) {
        addToolCall(toolCall);
      }
    }

    console.log(`[BaseWorker] Total tools extracted: ${toolsExecuted.length}, with results: ${toolsExecuted.filter(t => t.result !== undefined).length}`);

    return toolsExecuted;
  }

  /**
   * Get worker definition
   */
  getDefinition(): WorkerDefinition {
    return this.definition;
  }

  /**
   * Get associated guideline IDs
   */
  getGuidelineIds(): string[] {
    return this.definition.associatedGuidelineIds;
  }
}
