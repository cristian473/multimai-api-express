import { generateText } from 'ai';
import type { 
  MicroAgentConfig, 
  MicroAgentResult, 
  MicroAgentExecutionContext,
  MicroAgentEvaluationResult,
  MicroAgentIterationState
} from '../types/micro-agent-types';
import type { Guideline } from '../types/guideline';
import { getModel } from '../openrouter';
import { AI_CONFIG } from '../config';

/**
 * Abstract base class for all micro-agents
 * Provides common functionality for execution, evaluation, and iteration
 */
export abstract class BaseMicroAgent {
  protected config: MicroAgentConfig;

  constructor(config: MicroAgentConfig) {
    this.config = config;
  }

  /**
   * Determine if this micro-agent should activate based on context
   */
  abstract shouldActivate(context: MicroAgentExecutionContext): boolean;

  /**
   * Execute the micro-agent's specific logic (single iteration)
   */
  protected abstract executeIteration(
    context: MicroAgentExecutionContext,
    previousState?: MicroAgentIterationState
  ): Promise<{
    response: string;
    toolsExecuted: string[];
  }>;

  /**
   * Evaluate the response from this iteration
   */
  protected abstract evaluate(
    response: string,
    context: MicroAgentExecutionContext,
    toolsExecuted: string[]
  ): Promise<MicroAgentEvaluationResult>;

  /**
   * Main execution method with iteration loop
   */
  async execute(context: MicroAgentExecutionContext): Promise<MicroAgentResult> {
    const startTime = Date.now();
    
    console.log(`[${this.config.id}] Starting execution...`);

    if (!this.shouldActivate(context)) {
      console.log(`[${this.config.id}] Not activated for this context`);
      return {
        agentId: this.config.id,
        success: true,
        response: '',
        metadata: {
          iterations: 0,
          toolsExecuted: [],
          executionTimeMs: Date.now() - startTime,
          activatedGuidelines: []
        }
      };
    }

    const activatedGuidelines = context.activeGuidelines
      .filter(g => this.config.associatedGuidelineIds.includes(g.guideline.id))
      .map(g => g.guideline.id);

    console.log(`[${this.config.id}] Activated with guidelines:`, activatedGuidelines);

    let currentState: MicroAgentIterationState | undefined;
    let finalResponse = '';
    let allToolsExecuted: string[] = [];
    let finalScore: number | undefined;

    // Iteration loop
    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      console.log(`[${this.config.id}] Iteration ${iteration}/${this.config.maxIterations}`);

      try {
        // Execute iteration
        const { response, toolsExecuted } = await this.executeIteration(context, currentState);
        
        finalResponse = response;
        allToolsExecuted = [...new Set([...allToolsExecuted, ...toolsExecuted])];

        // Evaluate response
        console.log(`[${this.config.id}] Evaluating iteration ${iteration}...`);
        const evaluationResult = await this.evaluate(response, context, toolsExecuted);
        
        finalScore = evaluationResult.score;

        console.log(`[${this.config.id}] Evaluation score: ${evaluationResult.score}/10`);
        console.log(`[${this.config.id}] Valid: ${evaluationResult.isValid}`);

        // Update state
        currentState = {
          iteration,
          response,
          evaluationResult,
          toolsExecuted
        };

        // Check if we should stop
        if (evaluationResult.isValid && !evaluationResult.shouldRetry) {
          console.log(`[${this.config.id}] ✓ Evaluation passed, stopping iterations`);
          break;
        }

        if (iteration === this.config.maxIterations) {
          console.log(`[${this.config.id}] ⚠ Max iterations reached`);
          break;
        }

        console.log(`[${this.config.id}] Retrying with feedback:`, evaluationResult.suggestions);

      } catch (error) {
        console.error(`[${this.config.id}] Error in iteration ${iteration}:`, error);
        
        return {
          agentId: this.config.id,
          success: false,
          response: '',
          metadata: {
            iterations: iteration,
            toolsExecuted: allToolsExecuted,
            executionTimeMs: Date.now() - startTime,
            activatedGuidelines
          },
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    const executionTimeMs = Date.now() - startTime;

    console.log(`[${this.config.id}] Completed in ${executionTimeMs}ms with ${currentState?.iteration || 0} iterations`);

    return {
      agentId: this.config.id,
      success: true,
      response: finalResponse,
      metadata: {
        iterations: currentState?.iteration || 0,
        finalScore,
        toolsExecuted: allToolsExecuted,
        executionTimeMs,
        activatedGuidelines
      }
    };
  }

  /**
   * Build a specific prompt for this micro-agent
   */
  protected buildPrompt(
    context: MicroAgentExecutionContext,
    previousState?: MicroAgentIterationState
  ): string {
    let prompt = `<micro_agent_prompt>\n\n`;

    // Role and objective
    prompt += `  <role>\n`;
    prompt += `    <nombre>${this.config.name}</nombre>\n`;
    prompt += `    <descripcion>${this.config.description}</descripcion>\n`;
    prompt += `  </role>\n\n`;

    // User message
    prompt += `  <mensaje_usuario>\n`;
    prompt += `    <contenido>${context.userMessage}</contenido>\n`;
    prompt += `  </mensaje_usuario>\n\n`;

    // Active guidelines for this agent
    const relevantGuidelines = context.activeGuidelines.filter(g => 
      this.config.associatedGuidelineIds.includes(g.guideline.id)
    );

    if (relevantGuidelines.length > 0) {
      prompt += `  <guidelines_activas>\n`;
      relevantGuidelines.forEach((match, idx) => {
        const guideline = match.guideline;
        prompt += `    <guideline id="${idx + 1}">\n`;
        prompt += `      <id>${guideline.id}</id>\n`;
        prompt += `      <condicion>${guideline.condition}</condicion>\n`;
        prompt += `      <accion>${guideline.action}</accion>\n`;
        
        // Add validation criteria if present
        if (guideline.validationCriteria && guideline.validationCriteria.length > 0) {
          prompt += `      <criterios_validacion>\n`;
          guideline.validationCriteria.forEach((criterion, critIdx) => {
            prompt += `        <criterio id="${critIdx + 1}">\n`;
            prompt += `          <nombre>${criterion.name}</nombre>\n`;
            prompt += `          <descripcion>${criterion.description}</descripcion>\n`;
            prompt += `        </criterio>\n`;
          });
          prompt += `      </criterios_validacion>\n`;
        }
        
        prompt += `    </guideline>\n`;
      });
      prompt += `  </guidelines_activas>\n\n`;
    }

    // Previous iteration feedback
    if (previousState?.evaluationResult) {
      const evaluation = previousState.evaluationResult;
      prompt += `  <feedback_iteracion_previa>\n`;
      prompt += `    <iteracion>${previousState.iteration}</iteracion>\n`;
      prompt += `    <puntaje>${evaluation.score}/10</puntaje>\n`;
      
      if (evaluation.issues.length > 0) {
        prompt += `    <problemas>\n`;
        evaluation.issues.forEach((issue, idx) => {
          prompt += `      <problema id="${idx + 1}">${issue}</problema>\n`;
        });
        prompt += `    </problemas>\n`;
      }
      
      if (evaluation.suggestions.length > 0) {
        prompt += `    <sugerencias>\n`;
        evaluation.suggestions.forEach((suggestion, idx) => {
          prompt += `      <sugerencia id="${idx + 1}">${suggestion}</sugerencia>\n`;
        });
        prompt += `    </sugerencias>\n`;
      }
      
      prompt += `  </feedback_iteracion_previa>\n\n`;
    }

    // Instructions
    prompt += `  <instrucciones>\n`;
    prompt += `    <instruccion>Responde SOLO enfocándote en las guidelines activas para este micro-agente</instruccion>\n`;
    prompt += `    <instruccion>Sé conciso y directo en tu respuesta</instruccion>\n`;
    prompt += `    <instruccion>Usa las herramientas disponibles siempre</instruccion>\n`;
    prompt += `    <instruccion>Si hay feedback de iteración previa, DEBES incorporar todas las sugerencias</instruccion>\n`;
    prompt += `  </instrucciones>\n\n`;

    prompt += `</micro_agent_prompt>`;

    return prompt;
  }

  /**
   * Helper to generate text with model
   */
  protected async generateWithModel(
    systemPrompt: string,
    userMessage: string,
    tools?: any
  ): Promise<any> {
    const model = getModel(AI_CONFIG?.COMPOSER_MODEL_MEDIUM ?? 'groq/openai/gpt-oss-120b');

    return await generateText({
      model,
      system: systemPrompt,
      prompt: userMessage,
      tools,
      maxOutputTokens: 1500,
      temperature: 0.7
    });
  }

  /**
   * Get config
   */
  getConfig(): MicroAgentConfig {
    return this.config;
  }
}
