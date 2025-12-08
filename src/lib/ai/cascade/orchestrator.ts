/**
 * Cascade Orchestrator
 * Main controller for the cascade workflow
 * Coordinates: Classifier → Planner → Workers → Writer → StyleValidator
 */

import { ActionPlanner, type PlannerOutput } from './planner/action-planner';
import { ResponseWriter } from './writer/response-writer';
import { StyleValidator } from './validators/style-validator';
import { BaseWorker } from './workers/base-worker';
import { SearchWorker } from './workers/search-worker';
import { VisitWorker } from './workers/visit-worker';
import { SupportWorker } from './workers/support-worker';
import { FeedbackWorker } from './workers/feedback-worker';
import { ReasoningAgent, type ReasoningOutput } from './agents/reasoning-agent';
import { ContextSearchAgent, type ContextSearchOutput } from './agents/context-search-agent';
import type { 
  CascadeExecutionResult, 
  CascadeConfig, 
  WorkerResult, 
  WorkerExecutionContext,
  ActionPlan,
  ClassificationResult,
  WORKER_REGISTRY
} from './types';
import type { GuidelineMatch } from '../types/guideline';
import type { ConversationContext } from '../types/context';
import type { GuidelineAgent } from '../guideline-agent';
import type { ContextSearchResult } from '../micro-agents/context-search-agent';
import { LLMMessage } from '../context';

export interface CascadeOrchestratorConfig extends Partial<CascadeConfig> {
  guidelineAgent: GuidelineAgent;
  uid: string;
  userPhone: string;
  userName?: string;
}

const DEFAULT_CONFIG: CascadeConfig = {
  maxWorkerRetries: 2,
  maxWriterRetries: 2,
  workerTimeout: 30000,
  parallelExecution: true,
  criticalPathEnabled: true,
  styleValidationEnabled: true
};

export class CascadeOrchestrator {
  private config: CascadeConfig;
  private guidelineAgent: GuidelineAgent;
  private uid: string;
  private userPhone: string;
  private userName?: string;

  private planner: ActionPlanner;
  private writer: ResponseWriter;
  private styleValidator: StyleValidator;
  private workers: Map<string, BaseWorker>;
  
  // Non-worker agents for reasoning and context search
  private reasoningAgent: ReasoningAgent;
  private contextSearchAgent: ContextSearchAgent;

  constructor(orchestratorConfig: CascadeOrchestratorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...orchestratorConfig };
    this.guidelineAgent = orchestratorConfig.guidelineAgent;
    this.uid = orchestratorConfig.uid;
    this.userPhone = orchestratorConfig.userPhone;
    this.userName = orchestratorConfig.userName;

    // Initialize components
    this.planner = new ActionPlanner();
    this.writer = new ResponseWriter({ maxRetries: this.config.maxWriterRetries });
    this.styleValidator = new StyleValidator();
    
    // Initialize non-worker agents
    this.reasoningAgent = new ReasoningAgent();
    this.contextSearchAgent = new ContextSearchAgent();

    // Initialize workers
    this.workers = new Map();
    this.initializeWorkers();
  }

  /**
   * Initialize all workers and set their guideline agent
   */
  private initializeWorkers(): void {
    const searchWorker = new SearchWorker();
    searchWorker.setGuidelineAgent(this.guidelineAgent);
    this.workers.set('search_worker', searchWorker);

    const visitWorker = new VisitWorker();
    visitWorker.setGuidelineAgent(this.guidelineAgent);
    this.workers.set('visit_worker', visitWorker);

    const supportWorker = new SupportWorker();
    supportWorker.setGuidelineAgent(this.guidelineAgent);
    this.workers.set('support_worker', supportWorker);

    const feedbackWorker = new FeedbackWorker();
    feedbackWorker.setGuidelineAgent(this.guidelineAgent);
    this.workers.set('feedback_worker', feedbackWorker);

    console.log(`[CascadeOrchestrator] Initialized ${this.workers.size} workers`);
  }

  /**
   * Main execution method
   */
  async execute(
    userMessage: string,
    messages: LLMMessage[],
    activeGuidelines: GuidelineMatch[],
    glossaryContext?: string,
    ragContext?: ContextSearchResult | null
  ): Promise<CascadeExecutionResult> {
    const startTime = Date.now();
    console.log('\n[CascadeOrchestrator] ========== CASCADE EXECUTION START ==========');

    // Get resolved context variables once for the entire execution
    const contextVariables = await this.guidelineAgent.getResolvedContextVariables();
    console.log(`[CascadeOrchestrator] Context variables loaded: ${Object.keys(contextVariables).join(', ')}`);

    try {
      // Step 1: Plan
      console.log('[CascadeOrchestrator] Step 1: Planning...');
      const plannerOutput = await this.planner.plan({
        userMessage,
        messages,
        activeGuidelines,
      });

      console.log(`[CascadeOrchestrator] Classification: ${plannerOutput.classification.classification}`);
      console.log(`[CascadeOrchestrator] Direct to writer: ${plannerOutput.plan.directToWriter}`);
      console.log(`[CascadeOrchestrator] Tasks: ${plannerOutput.plan.tasks.length}`);

      // Step 2: Execute workers (if needed)
      let workerResults: WorkerResult[] = [];

      if (!plannerOutput.plan.directToWriter && plannerOutput.plan.tasks.length > 0) {
        console.log('[CascadeOrchestrator] Step 2: Executing workers...');
        workerResults = await this.executeWorkers(
          plannerOutput.plan,
          userMessage,
          messages,
          activeGuidelines,
          contextVariables
        );

        console.log(`[CascadeOrchestrator] Workers completed: ${workerResults.length}`);
        workerResults.forEach(r => {
          console.log(`  - ${r.workerId}: ${r.status} (score: ${r.validation.score})`);
        });

        // Check critical path
        if (this.config.criticalPathEnabled && plannerOutput.plan.criticalPath) {
          const failedWorkers = workerResults.filter(r => r.status === 'failed');
          if (failedWorkers.length > 0) {
            console.log('[CascadeOrchestrator] Critical path failure detected');
            return this.createFailureResult(
              plannerOutput.classification,
              plannerOutput.plan,
              workerResults,
              `Critical worker(s) failed: ${failedWorkers.map(w => w.workerId).join(', ')}`,
              startTime
            );
          }
        }
      } else {
        console.log('[CascadeOrchestrator] Step 2: Skipping workers (direct to writer)');
      }

      // Step 3: Compose response with Writer
      console.log('[CascadeOrchestrator] Step 3: Composing response...');
      let writerIterations = 0;
      let response = '';

      // Compose response with writer
      const writerOutput = await this.writer.compose({
        userMessage,
        messages,
        activeGuidelines,
        workerResults,
        plan: plannerOutput.plan,
        glossaryContext,
        ragContext,
        contextVariables
      });

      response = writerOutput.response;
      writerIterations = 1;

      // Step 4: Style validation and correction (if enabled)
      if (this.config.styleValidationEnabled) {
        console.log('[CascadeOrchestrator] Step 4: Style validation and correction...');
        
        const styleResult = await this.styleValidator.validateAndCorrect(
          response,
          userMessage,
          activeGuidelines,
          contextVariables
        );

        // Use the corrected response directly
        response = styleResult.response;
        
        console.log(`[CascadeOrchestrator] Style score: ${styleResult.score}/10, Corrected: ${styleResult.wasCorreced}`);
      }

      const totalTime = Date.now() - startTime;
      console.log(`[CascadeOrchestrator] ========== CASCADE EXECUTION END (${totalTime}ms) ==========\n`);

      return {
        success: true,
        response,
        metadata: {
          classification: plannerOutput.classification,
          plan: plannerOutput.plan,
          workerResults,
          writerIterations,
          styleValidationPassed: true,
          totalExecutionTimeMs: totalTime,
          executedGuidelines: activeGuidelines.map(g => g.guideline.id)
        }
      };

    } catch (error) {
      console.error('[CascadeOrchestrator] Error:', error);
      
      return {
        success: false,
        response: this.createFallbackResponse(),
        metadata: {
          classification: { 
            classification: 'text_only', 
            confidence: 0, 
            reasoning: 'Error during execution',
            detectedIntents: []
          },
          workerResults: [],
          writerIterations: 0,
          styleValidationPassed: false,
          totalExecutionTimeMs: Date.now() - startTime,
          executedGuidelines: []
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Execute workers based on the plan
   * Returns: { results, askToUser } where askToUser contains info if we need to stop and ask user
   */
  private async executeWorkers(
    plan: ActionPlan,
    userMessage: string,
    messages: LLMMessage[],
    activeGuidelines: GuidelineMatch[],
    contextVariables: Record<string, string>
  ): Promise<WorkerResult[]> {
    const results: WorkerResult[] = [];
    const taskResults = new Map<string, string>(); // Store results by task ID

    // Sort tasks by step number
    const sortedTasks = [...plan.tasks].sort((a, b) => a.step - b.step);

    // Process tasks sequentially (respecting dependencies)
    for (const task of sortedTasks) {
      console.log(`[CascadeOrchestrator] Processing task ${task.step}: ${task.description} (type: ${task.type})`);

      // Check if dependencies are met
      if (task.dependsOn && task.dependsOn.length > 0) {
        const dependenciesMet = task.dependsOn.every(depId => {
          return taskResults.has(depId);
        });

        if (!dependenciesMet) {
          console.warn(`[CascadeOrchestrator] Dependencies not met for task ${task.id}, skipping`);
          task.status = 'failed';
          task.error = 'Dependencies not completed';
          continue;
        }
      }

      task.status = 'running';

      // Handle ask_to_user task type - stop execution and go to writer
      if (task.type === 'ask_to_user') {
        console.log(`[CascadeOrchestrator] Task ${task.id} is ask_to_user, stopping execution to ask user`);
        
        // Collect all previous task results as context for the writer
        const collectedContext: string[] = [];
        taskResults.forEach((result, id) => {
          collectedContext.push(`[Task ${id}]: ${result}`);
        });
        
        task.status = 'ask_user';
        task.result = `[ASK_TO_USER]\nQuestion: ${task.questionForUser || task.description}\nCollected Context:\n${collectedContext.join('\n')}`;
        taskResults.set(task.id, task.result);
        
        // Mark remaining tasks as skipped
        for (const remainingTask of sortedTasks) {
          if (remainingTask.step > task.step && remainingTask.status === 'pending') {
            remainingTask.status = 'pending'; // Keep as pending for potential future execution
            console.log(`[CascadeOrchestrator] Task ${remainingTask.id} skipped due to ask_to_user`);
          }
        }
        
        // Create a synthetic worker result to pass the ask_to_user info to the writer
        results.push({
          workerId: 'ask_to_user',
          status: 'success',
          response: task.result,
          toolsExecuted: [],
          validation: {
            passed: true,
            score: 10,
            iterations: 0,
            feedback: 'User interaction required',
            guidelinesCriteria: []
          },
          metadata: {
            executionTimeMs: 0,
            activatedGuidelines: []
          }
        });
        
        // Break out of the loop - go directly to writer
        break;
      }

      // Handle different task types
      if (task.type === 'reasoning') {
        // Use ReasoningAgent
        console.log(`[CascadeOrchestrator] Task ${task.id} is reasoning, using ReasoningAgent`);
        
        const previousTaskResults = new Map<string, string>();
        taskResults.forEach((result, id) => previousTaskResults.set(id, result));
        
        const reasoningResult = await this.reasoningAgent.execute({
          task,
          userMessage,
          messages,
          activeGuidelines,
          previousTaskResults,
          planContext: plan
        });
        
        if (reasoningResult.success) {
          task.status = 'completed';
          // Format result with reasoning details
          task.result = `[REASONING]\nConclusion: ${reasoningResult.conclusion}\n` +
            `Confidence: ${reasoningResult.confidence}\n` +
            (Object.keys(reasoningResult.extractedData || {}).length > 0 
              ? `Data: ${JSON.stringify(reasoningResult.extractedData)}\n` 
              : '') +
            `Details: ${reasoningResult.reasoning}`;
          taskResults.set(task.id, task.result);
          console.log(`[CascadeOrchestrator] Reasoning completed with confidence ${reasoningResult.confidence}`);
        } else {
          task.status = 'failed';
          task.error = reasoningResult.error || 'Reasoning failed';
          console.error(`[CascadeOrchestrator] Reasoning failed: ${reasoningResult.error}`);
        }
        continue;
      }
      
      if (task.type === 'context_search') {
        // Use ContextSearchAgent
        console.log(`[CascadeOrchestrator] Task ${task.id} is context_search, using ContextSearchAgent`);
        
        const previousTaskResults = new Map<string, string>();
        taskResults.forEach((result, id) => previousTaskResults.set(id, result));
        
        const searchResult = await this.contextSearchAgent.execute({
          task,
          userMessage,
          messages,
          activeGuidelines,
          previousTaskResults,
          planContext: plan
        });
        
        if (searchResult.success) {
          task.status = 'completed';
          // Format result with search findings
          task.result = `[CONTEXT_SEARCH]\nSummary: ${searchResult.summary}\n` +
            `Confidence: ${searchResult.confidence}\n` +
            `Items Found: ${searchResult.foundItems.length}\n` +
            searchResult.foundItems.map((item, i) => 
              `  ${i + 1}. [${item.type}] ${item.content.substring(0, 200)}${item.content.length > 200 ? '...' : ''}`
            ).join('\n');
          taskResults.set(task.id, task.result);
          console.log(`[CascadeOrchestrator] Context search found ${searchResult.foundItems.length} items`);
        } else {
          task.status = 'failed';
          task.error = searchResult.error || 'Context search failed';
          console.error(`[CascadeOrchestrator] Context search failed: ${searchResult.error}`);
        }
        continue;
      }

      // Worker call task
      if (task.type === 'worker_call') {
        if (!task.workerId) {
          console.warn(`[CascadeOrchestrator] No workerId for worker_call task ${task.id}`);
          task.status = 'failed';
          task.error = 'No workerId specified';
          continue;
        }

        const worker = this.workers.get(task.workerId);
        if (!worker) {
          console.warn(`[CascadeOrchestrator] Worker not found: ${task.workerId}`);
          results.push(this.createWorkerNotFoundResult(task.workerId));
          task.status = 'failed';
          task.error = `Worker ${task.workerId} not found`;
          continue;
        }

        // Build previous task results map
        const previousTaskResults = new Map<string, string>();
        taskResults.forEach((result, id) => previousTaskResults.set(id, result));

        const context: WorkerExecutionContext = {
          userMessage,
          messages,
          activeGuidelines,
          task,
          uid: this.uid,
          userPhone: this.userPhone,
          userName: this.userName,
          planContext: plan,
          previousTaskResults,
          contextVariables
        };

        const result = await worker.execute(context);
        results.push(result);

        // Store result for dependent tasks
        task.status = result.status === 'success' ? 'completed' : 'failed';
        task.result = result.response;
        taskResults.set(task.id, result.response);

        // If critical path and failed, abort
        if (plan.criticalPath && result.status !== 'success') {
          console.error(`[CascadeOrchestrator] Critical task failed: ${task.id}`);
          break;
        }
      }
    }

    // For backward compatibility, handle any remaining dependent tasks
    const pendingDependentTasks = sortedTasks.filter(t => 
      t.type === 'worker_call' && 
      t.status === 'pending' && 
      t.dependsOn && 
      t.dependsOn.length > 0
    );

    for (const task of pendingDependentTasks) {
      // Check if dependencies completed successfully
      const dependenciesMet = task.dependsOn.every(depId => {
        return taskResults.has(depId);
      });

      if (!dependenciesMet) {
        console.warn(`[CascadeOrchestrator] Dependencies not met for: ${task.workerId}`);
        results.push({
          workerId: task.workerId,
          status: 'failed',
          response: '',
          toolsExecuted: [],
          validation: {
            passed: false,
            score: 0,
            iterations: 0,
            feedback: 'Dependencies not met',
            guidelinesCriteria: []
          },
          metadata: {
            executionTimeMs: 0,
            activatedGuidelines: []
          },
          error: 'Dependencies not met'
        });
        continue;
      }

      const worker = this.workers.get(task.workerId);
      if (!worker) {
        results.push(this.createWorkerNotFoundResult(task.workerId));
        continue;
      }

      // Build previous task results map
      const previousTaskResults = new Map<string, string>();
      taskResults.forEach((result, id) => previousTaskResults.set(id, result));

      const context: WorkerExecutionContext = {
        userMessage,
        messages,
        activeGuidelines,
        task,
        uid: this.uid,
        userPhone: this.userPhone,
        userName: this.userName,
        planContext: plan,
        previousTaskResults,
        contextVariables
      };

      const result = await worker.execute(context);
      results.push(result);
      
      // Store result for future reference
      task.status = result.status === 'success' ? 'completed' : 'failed';
      task.result = result.response;
      taskResults.set(task.id, result.response);
    }

    return results;
  }

  /**
   * Create result for worker not found
   */
  private createWorkerNotFoundResult(workerId: string): WorkerResult {
    return {
      workerId,
      status: 'failed',
      response: '',
      toolsExecuted: [],
      validation: {
        passed: false,
        score: 0,
        iterations: 0,
        feedback: 'Worker not found',
        guidelinesCriteria: []
      },
      metadata: {
        executionTimeMs: 0,
        activatedGuidelines: []
      },
      error: `Worker '${workerId}' not found in registry`
    };
  }

  /**
   * Create failure result
   */
  private createFailureResult(
    classification: ClassificationResult,
    plan: ActionPlan,
    workerResults: WorkerResult[],
    error: string,
    startTime: number
  ): CascadeExecutionResult {
    return {
      success: false,
      response: this.createFallbackResponse(),
      metadata: {
        classification,
        plan,
        workerResults,
        writerIterations: 0,
        styleValidationPassed: false,
        totalExecutionTimeMs: Date.now() - startTime,
        executedGuidelines: []
      },
      error
    };
  }

  /**
   * Create fallback response for errors
   */
  private createFallbackResponse(): string {
    return 'Disculpa, tuve un pequeño problema técnico. ¿Podrías repetirme tu consulta?';
  }

  /**
   * Get all collected tool executions from workers
   */
  getToolExecutions(workerResults: WorkerResult[]): Array<{
    workerId: string;
    toolName: string;
    args: Record<string, any>;
    result: any;
    timestamp: number;
  }> {
    const executions: Array<{
      workerId: string;
      toolName: string;
      args: Record<string, any>;
      result: any;
      timestamp: number;
    }> = [];

    for (const result of workerResults) {
      for (const tool of result.toolsExecuted) {
        executions.push({
          workerId: result.workerId,
          ...tool
        });
      }
    }

    return executions;
  }
}

