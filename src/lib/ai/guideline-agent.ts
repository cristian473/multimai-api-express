import { GlossaryStore } from './core/glossary-store';
import { GuidelineMatcher } from './core/guideline-matcher';
import { ToolOrchestrator } from './core/tool-orchestrator';
import { MessageComposer } from './core/message-composer';
import { tool } from 'ai';
import type { 
  Guideline, 
  GuidelineMatch
} from './types/guideline';
import type {
  ConversationContext,
  AgentState,
  ContextVariable
} from './types/context';
import type { ContextSearchResult } from './micro-agents/context-search-agent';

export interface GlossaryTerm {
  term: string;
  definition: string;
  synonyms?: string[];
}

// Type helper for tools - use any for now to accept all tool definitions
type ToolDefinitionType = ReturnType<typeof tool<any, any>>;

export interface GuidelineAgentOptions {
  streaming?: boolean;
  enableCritique?: boolean;
  maxSteps?: number;
  guidelineThreshold?: number;
}

export class GuidelineAgent {
  private glossary: GlossaryStore;
  public matcher: GuidelineMatcher;
  private orchestrator: ToolOrchestrator;
  private composer: MessageComposer;
  private options: GuidelineAgentOptions;
  private contextVariables: Map<string, ContextVariable> = new Map();

  constructor(
    guidelines: Guideline[],
    domainTerms: Record<string, string> = {},
    options: GuidelineAgentOptions = {}
  ) {
    this.options = {
      streaming: false,
      enableCritique: false,
      maxSteps: 3,
      guidelineThreshold: 0.7,
      ...options
    };

    this.glossary = new GlossaryStore(domainTerms);
    this.matcher = new GuidelineMatcher(guidelines);
    this.orchestrator = new ToolOrchestrator();
    this.composer = new MessageComposer({
      streaming: this.options.streaming,
      enableSelfCritique: this.options.enableCritique
    });

    console.log('[GuidelineAgent] Initialized with', guidelines.length, 'guidelines');
  }

  // Register tool
  registerTool(
    name: string,
    description: string,
    toolDefinition: ToolDefinitionType,
    associatedGuidelines?: string[]
  ): void {
    this.orchestrator.registerAiSdkTool(name, description, toolDefinition, associatedGuidelines);
  }

  // Register context variable
  registerVariable(
    name: string,
    value: string | (() => string) | (() => Promise<string>),
    description?: string
  ): void {
    this.contextVariables.set(name, { name, value, description });
  }

  // Resolve context variables (evaluate functions)
  // Resolve context variables (evaluate functions)
  private async resolveContextVariables(): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};
    
    for (const [name, variable] of this.contextVariables.entries()) {
      try {
        if (typeof variable.value === 'function') {
          const result = variable.value();
          resolved[name] = result instanceof Promise ? await result : result;
        } else {
          resolved[name] = variable.value;
        }
      } catch (error) {
        console.error(`[GuidelineAgent] Error resolving variable ${name}:`, error);
        resolved[name] = '[Error resolving variable]';
      }
    }

    return resolved;
  }

  /**
   * Get resolved context variables (public method for external use)
   * Used by CascadeOrchestrator to pass variables to workers
   */
  async getResolvedContextVariables(): Promise<Record<string, string>> {
    return this.resolveContextVariables();
  }

  public async checkGlossary(message: string, guidelines: GuidelineMatch[]): Promise<GlossaryTerm[]> {
    const relevantTerms: GlossaryTerm[] = [];
    
    // Get all glossary terms from active guidelines
    const termsToCheck = new Set<string>();
    guidelines.forEach(match => {
      if (match.guideline.glossaryTerms) {
        match.guideline.glossaryTerms.forEach(term => termsToCheck.add(term));
      }
    });

    if (termsToCheck.size === 0) return [];

    // Check if terms appear in message (case insensitive)
    const lowerMessage = message.toLowerCase();
    const definitions = this.glossary.getDefinitions(Array.from(termsToCheck));
    
    for (const [term, definition] of Object.entries(definitions)) {
      if (lowerMessage.includes(term.toLowerCase())) {
        relevantTerms.push({ term, definition });
      }
    }

    return relevantTerms;
  }

  // Process user message
  async process(
    userMessage: string,
    context: ConversationContext,
    maxSteps?: number,
    activeGuidelines?: GuidelineMatch[] | null,
    microAgentsContext?: string,
    chainOfThought?: string | null,
    ragContext?: ContextSearchResult | null
  ): Promise<{
    response: string;
    state: AgentState;
    executionTrace: any[];
  }> {
    const maxStepsToRun = maxSteps || this.options.maxSteps || 3;
    const trace: any[] = [];
    
    console.log('\n========== GUIDELINE AGENT PROCESSING START ==========');
    console.log('[GuidelineAgent] User message:', userMessage);
    console.log('[GuidelineAgent] Session:', context.sessionId);

    let currentContext = {
      ...context,
      messages: [
        ...context.messages,
      ]
    };

    // Step 0: Resolve context variables
    console.log('\n[Step 0] Resolving context variables...');
    const contextVariables = await this.resolveContextVariables();
    trace.push({ step: 'context_variables', variables: contextVariables });
    // console.log('[GuidelineAgent] Context variables:', contextVariables);

    // Step 1: Extract relevant terms from glossary
    console.log('\n[Step 1] Extracting glossary terms...');
    // const relevantTerms = await this.glossary.extractRelevantTerms(userMessage);
    // const glossaryContext = this.glossary.buildEnrichedContext(relevantTerms);
    // trace.push({ step: 'glossary', terms: relevantTerms });
    // console.log('[GuidelineAgent] Relevant terms:', relevantTerms);

    // Step 2: Match guidelines
    console.log('\n[Step 2] Matching guidelines...');
    // let activeGuidelines = await this.matcher.matchGuidelines(
    //   currentContext,
    //   this.options.guidelineThreshold
    // );
    trace.push({ 
      step: 'matching', 
      matched: activeGuidelines.map(m => ({
        id: m.guideline.id,
        score: m.score,
        reason: m.reason
      }))
    });

    // Step 3: Get tools for active guidelines
    console.log('\n[Step 3] Getting tools for active guidelines...');
    const tools = this.orchestrator.getToolsForGuidelines(activeGuidelines);
    console.log(`[GuidelineAgent] Active guidelines: ${activeGuidelines.map(g => g.guideline.id).join(', ')}`);
    console.log(`[GuidelineAgent] Available tools for these guidelines: ${Object.keys(tools).join(', ')}`);
    trace.push({ step: 'tools_preparation', tools: Object.keys(tools) });

    // Step 4: Compose and execute with tools (Loop)
    console.log('\n[Step 4] Composing response with AI and tools...');
    
    // Initialize currentToolResults from microAgentsContext if available
    let currentToolResults: Array<{ toolName: string; result: any }> = [];
    let finalResponse = '';
    let lastTextResponse = '';
    let loopCount = 0;
    const maxLoops = maxStepsToRun;

    while (loopCount < maxLoops) {
      console.log(`\n[GuidelineAgent] Execution loop ${loopCount + 1}/${maxLoops}`);
      
      const response = await this.composer.compose(
        currentContext,
        activeGuidelines,
        '', // glossary - empty, in CoT now
        tools, // Pass tools Record directly instead of Object.values(tools)
        currentToolResults,
        contextVariables,
        null, // executionContextSummary - in CoT now
        microAgentsContext,
        chainOfThought,
        ragContext || null // RAG context from context search agent
      );

      const responseData = 'steps' in response && !('then' in response) ? response : { steps: [], text: await (response as any).text };
      const textResponse = typeof responseData.text === 'string' ? responseData.text : await responseData.text;
      
      if (textResponse) {
        lastTextResponse = textResponse;
      }
      
      // If we have text and no tool calls, we're done
      // But wait, we need to check for tool calls in this response
      const steps = responseData.steps instanceof Promise ? await responseData.steps : responseData.steps;
      let hasToolCalls = false;

      if (steps && Array.isArray(steps) && steps.length > 0) {
        const allToolCalls = steps.flatMap((step: any) => step.toolCalls || []);
        
        if (allToolCalls.length > 0) {
          hasToolCalls = true;
          console.log(`[GuidelineAgent] Tools called: ${allToolCalls.length}`);
          
          // Execute tools
          for (const call of allToolCalls) {
            console.log(`  - ${call.toolName}`);
            // Execute tool via orchestrator or directly? 
            // The orchestrator.executeTool method doesn't exist in the snippet I saw, 
            // but we have tools map.
            // Wait, MessageComposer executes tools if using Vercel AI SDK 'generateText' with tools?
            // No, generateText returns toolCalls, we must execute them.
            
            // Actually, if we use 'generateText' with 'tools', it might execute them if 'maxSteps' is set in generateText.
            // But MessageComposer uses generateText.
            // Let's check MessageComposer again. It returns toolCalls.
            
            // We need to execute the tool.
            // The 'tools' object contains the tool definitions.
            // We need to find the tool implementation and execute it.
            // But 'tools' here are just definitions (zod schemas etc).
            // The actual execution logic must be available.
            
            // In the previous code (step 388), it extracted results from 'toolResults' property of steps.
            // This implies the SDK might have executed them?
            // "const allToolResults = steps.flatMap((step: any) => step.toolResults || []);"
            // If MessageComposer uses 'generateText' without 'maxSteps', it returns toolCalls but doesn't execute them.
            // If it uses 'streamText' or 'generateText' with 'maxSteps', it might.
            
            // MessageComposer (step 406) uses:
            // const response = await generateText({ ... tools: ... });
            // It does NOT set maxSteps, so it does NOT execute tools automatically.
            // So 'response.toolCalls' contains the calls.
            // We must execute them here.
            
            try {
              // We need to execute the tool function.
              // The 'tools' map has the tool definitions.
              // But where is the executable function?
              // 'tool' from 'ai' SDK wraps the execute function.
              const toolDef = tools[call.toolName];
              if (toolDef && toolDef.execute) {
                console.log(`[GuidelineAgent] Executing ${call.toolName}...`);
                const result = await toolDef.execute(call.args, { 
                  toolCallId: call.toolCallId,
                  messages: currentContext.messages 
                });
                
                currentToolResults.push({
                  toolName: call.toolName,
                  result: result
                });
                
                trace.push({ 
                  step: 'tool_execution', 
                  toolName: call.toolName, 
                  args: call.args,
                  result: result 
                });
              } else {
                console.error(`[GuidelineAgent] Tool ${call.toolName} not found or not executable`);
              }
            } catch (err) {
              console.error(`[GuidelineAgent] Error executing tool ${call.toolName}:`, err);
              currentToolResults.push({
                toolName: call.toolName,
                result: { error: String(err) }
              });
            }
          }
        }
      }

      if (!hasToolCalls) {
        finalResponse = textResponse;
        break; // Done
      }
      
      // If we have tool calls, we loop again with updated currentToolResults
      loopCount++;
      
      // Update context with tool results for the next iteration?
      // MessageComposer takes 'toolResults' as argument.
      // We are passing 'currentToolResults' which accumulates results.
      // So the next compose call will see them.
    }

    if (!finalResponse) {
        if (lastTextResponse) {
            console.warn('[GuidelineAgent] Max loops reached. Using last text response.');
            finalResponse = lastTextResponse;
        } else {
            console.warn('[GuidelineAgent] Max loops reached without any text response. Using fallback.');
            finalResponse = 'Lo siento, tuve un problema procesando tu solicitud. ¿Podrías intentarlo de nuevo?';
        }
    }

    // Build final state
    const state: AgentState = {
      context: currentContext,
      activeGuidelines,
      glossaryTerms: [],
      conversationPhase: this.detectPhase(currentContext),
      contextVariables
    };

    console.log('\n[GuidelineAgent] Final response length:', finalResponse.length);
    console.log('[GuidelineAgent] Active guidelines:', activeGuidelines.map(g => g.guideline.id));
    console.log('========== GUIDELINE AGENT PROCESSING END ==========\n');

    return {
      response: finalResponse,
      state,
      executionTrace: trace
    };
  }

  // Add guideline at runtime
  addGuideline(guideline: Guideline): void {
    this.matcher.addGuideline(guideline);
  }

  // Add glossary term
  addGlossaryTerm(term: string, definition: string): void {
    this.glossary.addTerm(term, definition);
  }

  // Detect conversation phase
  private detectPhase(context: ConversationContext): AgentState['conversationPhase'] {
    const messageCount = context.messages.length;
    if (messageCount <= 2) return 'greeting';
    if (messageCount <= 6) return 'discovery';
    if (messageCount <= 15) return 'execution';
    return 'closing';
  }

  // Get registered tools
  getRegisteredTools(): string[] {
    return this.orchestrator.getRegisteredTools();
  }

  // Get execution log
  getExecutionLog() {
    return this.orchestrator.getExecutionLog();
  }

  /**
   * Get tool schemas for specific tools
   * Used by validators to know tool parameter formats
   */
  getToolSchemas(toolNames?: string[]): Record<string, { description: string; parameters: string }> {
    return this.orchestrator.getToolSchemas(toolNames);
  }
}

