import type { BaseMicroAgent } from './base-micro-agent';
import type { 
  MicroAgentResult, 
  MicroAgentExecutionContext 
} from '../types/micro-agent-types';
import type { GuidelineMatch } from '../types/guideline';
import type { ConversationContext } from '../types/context';

/**
 * Orchestrates parallel execution of micro-agents
 */
export class MicroAgentOrchestrator {
  private microAgents: BaseMicroAgent[] = [];

  /**
   * Register a micro-agent
   */
  registerMicroAgent(agent: BaseMicroAgent): void {
    this.microAgents.push(agent);
    console.log(`[MicroAgentOrchestrator] Registered agent: ${agent.getConfig().id}`);
  }

  /**
   * Determine which micro-agents should activate based on context
   */
  private determineActiveAgents(context: MicroAgentExecutionContext): BaseMicroAgent[] {
    const activeAgents: BaseMicroAgent[] = [];

    console.log('[MicroAgentOrchestrator] Determining active agents...');
    console.log('[MicroAgentOrchestrator] activeAgents', JSON.stringify(activeAgents))
    console.log('[MicroAgentOrchestrator] activeGuidelines', JSON.stringify(context.activeGuidelines))
    console.log('[MicroAgentOrchestrator] this.microAgents', JSON.stringify(this.microAgents))

    for (const agent of this.microAgents) {
      console.log(`[MicroAgentOrchestrator] Checking agent: ${agent.getConfig().id}`);
      console.log(`[MicroAgentOrchestrator] agent.getConfig().enabled`, agent.getConfig().enabled)
      console.log(`[MicroAgentOrchestrator] agent.shouldActivate(context)`, agent.shouldActivate(context))
      if (agent.getConfig().enabled && agent.shouldActivate(context)) {
        activeAgents.push(agent);
        console.log(`[MicroAgentOrchestrator] Activating agent: ${agent.getConfig().id}`);
      }
    }

    return activeAgents;
  }

  /**
   * Execute micro-agents in parallel
   */
  async executeInParallel(
    userMessage: string,
    conversationContext: ConversationContext,
    activeGuidelines: GuidelineMatch[], // Changed from Guideline[] to GuidelineMatch[]
    uid: string,
    userPhone: string,
    userName?: string
  ): Promise<MicroAgentResult[]> {
    console.log('[MicroAgentOrchestrator] Starting parallel execution...');
    console.log('[MicroAgentOrchestrator] Active guidelines:', activeGuidelines.map(g => g.guideline.id));

    // Build execution context
    const executionContext: MicroAgentExecutionContext = {
      userMessage,
      conversationContext,
      activeGuidelines,
      uid,
      userPhone,
      userName
    };

    // Determine which agents should activate
    const activeAgents = this.determineActiveAgents(executionContext);

    if (activeAgents.length === 0) {
      console.log('[MicroAgentOrchestrator] No micro-agents activated');
      return [];
    }

    console.log(`[MicroAgentOrchestrator] Executing ${activeAgents.length} agents in parallel...`);

    // Execute all active agents in parallel using Promise.allSettled
    const promises = activeAgents.map(agent => agent.execute(executionContext));
    const results = await Promise.allSettled(promises);

    // Process results
    const microAgentResults: MicroAgentResult[] = [];

    results.forEach((result, index) => {
      const agent = activeAgents[index];
      
      if (result.status === 'fulfilled') {
        microAgentResults.push(result.value);
        console.log(`[MicroAgentOrchestrator] ✓ Agent ${agent.getConfig().id} completed successfully`);
      } else {
        // Handle rejected promises
        console.error(`[MicroAgentOrchestrator] ✗ Agent ${agent.getConfig().id} failed:`, result.reason);
        microAgentResults.push({
          agentId: agent.getConfig().id,
          success: false,
          response: '',
          metadata: {
            iterations: 0,
            toolsExecuted: [],
            executionTimeMs: 0,
            activatedGuidelines: []
          },
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      }
    });

    console.log('[MicroAgentOrchestrator] Parallel execution completed');
    console.log('[MicroAgentOrchestrator] microAgentResults', JSON.stringify(microAgentResults))
    return microAgentResults;
  }

  /**
   * Aggregate results from micro-agents into a context summary for the composer
   */
  aggregateResults(results: MicroAgentResult[]): string {
    // Filter out empty results (agents that didn't activate or failed)
    const validResults = results.filter(r => r.success && r.response.trim().length > 0);

    if (validResults.length === 0) {
      return '';
    }

    console.log(`[MicroAgentOrchestrator] Aggregating ${validResults.length} valid micro-agent results...`);

    let aggregatedContext = `<micro_agents_analysis>\n`;
    aggregatedContext += `  <descripcion>Análisis previo realizado por micro-agentes especializados</descripcion>\n\n`;

    validResults.forEach((result, index) => {
      aggregatedContext += `  <agent id="${result.agentId}">\n`;
      aggregatedContext += `    <iteraciones>${result.metadata.iterations}</iteraciones>\n`;
      
      if (result.metadata.finalScore !== undefined) {
        aggregatedContext += `    <score_evaluacion>${result.metadata.finalScore}/10</score_evaluacion>\n`;
      }

      if (result.metadata.toolsExecuted.length > 0) {
        aggregatedContext += `    <herramientas_ejecutadas>\n`;
        result.metadata.toolsExecuted.forEach(tool => {
          aggregatedContext += `      <herramienta>${tool}</herramienta>\n`;
        });
        aggregatedContext += `    </herramientas_ejecutadas>\n`;
      }

      aggregatedContext += `    <analisis>\n`;
      aggregatedContext += `${result.response}\n`;
      aggregatedContext += `    </analisis>\n`;
      aggregatedContext += `  </agent>\n\n`;
    });

    aggregatedContext += `  <instrucciones_uso>\n`;
    aggregatedContext += `    <instruccion>Este análisis fue validado por evaluadores especializados con score >= 7/10</instruccion>\n`;
    aggregatedContext += `    <instruccion>Usa este contexto como base para construir tu respuesta final</instruccion>\n`;
    aggregatedContext += `    <instruccion>Puedes complementar con información adicional si es necesario</instruccion>\n`;
    aggregatedContext += `    <instruccion>NO repitas el análisis textualmente, intégralo naturalmente en tu respuesta</instruccion>\n`;
    aggregatedContext += `  </instrucciones_uso>\n`;

    aggregatedContext += `</micro_agents_analysis>`;

    console.log('[MicroAgentOrchestrator] Context aggregation completed');
    console.log('[MicroAgentOrchestrator] Total context length:', aggregatedContext.length);

    return aggregatedContext;
  }

  /**
   * Get statistics about micro-agent execution
   */
  getExecutionStats(results: MicroAgentResult[]): {
    total: number;
    successful: number;
    failed: number;
    totalIterations: number;
    totalExecutionTimeMs: number;
    averageScore?: number;
  } {
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalIterations = results.reduce((sum, r) => sum + r.metadata.iterations, 0);
    const totalExecutionTimeMs = results.reduce((sum, r) => sum + r.metadata.executionTimeMs, 0);

    const scores = results
      .filter(r => r.success && r.metadata.finalScore !== undefined)
      .map(r => r.metadata.finalScore!);

    const averageScore = scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : undefined;

    return {
      total: results.length,
      successful,
      failed,
      totalIterations,
      totalExecutionTimeMs,
      averageScore
    };
  }
}
