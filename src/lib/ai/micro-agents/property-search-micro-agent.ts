import { BaseMicroAgent } from './base-micro-agent';
import { PropertySearchEvaluator } from './evaluators/property-search-evaluator';
import type { 
  MicroAgentConfig, 
  MicroAgentExecutionContext, 
  MicroAgentEvaluationResult,
  MicroAgentIterationState
} from '../types/micro-agent-types';
import type { Guideline } from '../types/guideline';
import type { GuidelineAgent } from '../guideline-agent';

/**
 * Micro-agent specialized in property search and information retrieval
 */
export class PropertySearchMicroAgent extends BaseMicroAgent {
  private evaluator: PropertySearchEvaluator;
  private uid: string;
  private userPhone: string;
  private guidelineAgent: GuidelineAgent;

  constructor(
    uid: string,
    userPhone: string,
    allGuidelines: Guideline[],
    guidelineAgent: GuidelineAgent
  ) {
    const config: MicroAgentConfig = {
      id: 'property_search',
      name: 'Property Search Agent',
      description: 'Especializado en búsqueda y gestión de información de propiedades, debes realizar la busqueda siempre que te invoquen en la conversación',
      associatedGuidelineIds: [
        'search_properties',
        'get_property_detail',
        'show_interest',
        'property_reference_context',
        'no_results_fallback'
      ],
      toolNames: ['search_properties', 'get_property_info'],
      maxIterations: 2,
      evaluationThreshold: 7.0,
      enabled: true
    };

    super(config);

    this.uid = uid;
    this.userPhone = userPhone;
    this.guidelineAgent = guidelineAgent;
    this.evaluator = new PropertySearchEvaluator(config.evaluationThreshold);
  }

  shouldActivate(context: MicroAgentExecutionContext): boolean {
    // Activate if any of the associated guidelines are in the active guidelines
    return context.activeGuidelines.some(g =>
      this.config.associatedGuidelineIds.includes(g.guideline.id) // Access guideline.id from GuidelineMatch
    );
  }

  protected async executeIteration(
    context: MicroAgentExecutionContext,
    previousState?: MicroAgentIterationState
  ): Promise<{ response: string; toolsExecuted: string[] }> {
    console.log(`[${this.config.id}] Executing property search iteration...`);

    // Build prompt for this micro-agent
    const systemPrompt = this.buildPrompt(context, previousState);

    // Get available tools from guideline agent
    const registeredTools = this.guidelineAgent.getRegisteredTools();
    const relevantToolNames = this.config.toolNames.filter(tool =>
      registeredTools.includes(tool)
    );

    console.log(`[${this.config.id}] Available tools:`, relevantToolNames);

    // Execute with tools (using base class helper)
    const result = await this.generateWithModel(
      systemPrompt,
      context.userMessage
      // Note: We don't pass tools here as the micro-agent focuses on analysis
      // The actual tool execution is handled by the main composer
    );

    // Extract response
    const responseText = typeof result.text === 'string' 
      ? result.text 
      : await result.text;

    // For this micro-agent, we analyze what SHOULD be done
    // rather than executing tools directly
    const toolsExecuted: string[] = [];

    console.log(`[${this.config.id}] Generated analysis:`, responseText.substring(0, 200));

    return {
      response: responseText,
      toolsExecuted
    };
  }

  protected async evaluate(
    response: string,
    context: MicroAgentExecutionContext,
    toolsExecuted: string[]
  ): Promise<MicroAgentEvaluationResult> {
    return await this.evaluator.evaluate(response, context, toolsExecuted);
  }
}
