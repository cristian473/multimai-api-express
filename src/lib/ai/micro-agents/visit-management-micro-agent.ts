import { BaseMicroAgent } from './base-micro-agent';
import { VisitManagementEvaluator } from './evaluators/visit-management-evaluator';
import type { 
  MicroAgentConfig, 
  MicroAgentExecutionContext, 
  MicroAgentEvaluationResult,
  MicroAgentIterationState
} from '../types/micro-agent-types';
import type { Guideline } from '../types/guideline';
import type { GuidelineAgent } from '../guideline-agent';

/**
 * Micro-agent specialized in visit management (scheduling, canceling, rescheduling)
 */
export class VisitManagementMicroAgent extends BaseMicroAgent {
  private evaluator: VisitManagementEvaluator;
  private uid: string;
  private userPhone: string;
  private userName: string;
  private guidelineAgent: GuidelineAgent;

  constructor(
    uid: string,
    userPhone: string,
    userName: string,
    allGuidelines: Guideline[],
    guidelineAgent: GuidelineAgent
  ) {
    const config: MicroAgentConfig = {
      id: 'visit_management',
      name: 'Visit Management Agent',
      description: 'Especializado en gestión de visitas a propiedades (agendar, cancelar, reprogramar)',
      associatedGuidelineIds: [
        'check_visit_availability',
        'schedule_new_visit',
        'cancel_visit',
        'reschedule_visit',
        'visit_intent_without_details'
      ],
      toolNames: [
        'get_availability',
        'create_visit',
        'add_visitor',
        'cancel_visit',
        'reschedule_visit',
        'ask_availability'
      ],
      maxIterations: 1,
      evaluationThreshold: 7.0,
      enabled: true
    };

    super(config);

    this.uid = uid;
    this.userPhone = userPhone;
    this.userName = userName;
    this.guidelineAgent = guidelineAgent;
    this.evaluator = new VisitManagementEvaluator(config.evaluationThreshold);
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
    console.log(`[${this.config.id}] Executing visit management iteration...`);

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
