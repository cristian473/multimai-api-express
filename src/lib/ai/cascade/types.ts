/**
 * Types for the Cascade Workflow System
 * Supports distributed validation and parallel worker execution
 */

import type { GuidelineMatch } from '../types/guideline';
import type { MicroAgentEvaluationResult } from '../types/micro-agent-types';
import type { LLMMessage } from '../context/conversation-loader';
// ========== Classification Types ==========

export type MessageClassification = 'requires_action' | 'text_only';

export interface ClassificationResult {
  classification: MessageClassification;
  confidence: number;
  reasoning: string;
  detectedIntents: string[];
}

// ========== Action Plan Types ==========

// Task types for the planner
export type TaskType = 'reasoning' | 'context_search' | 'worker_call';

export interface PlanTask {
  id: string;                    // Unique task ID (e.g., "task_1")
  step: number;                  // Step number in sequence
  description: string;           // Natural language description of what to do
  type: TaskType;                // Type of task
  workerId: string;              // Worker ID (only for worker_call type, empty otherwise)
  dependsOn: string[];           // Task IDs that must complete first
  // Runtime fields (filled during execution)
  status?: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;               // Result of this task
  error?: string;                // Error if failed
}

export interface ActionPlan {
  tasks: PlanTask[];
  criticalPath: boolean; // If true, abort all if one fails
  directToWriter: boolean; // Skip workers, go directly to writer
  reasoning: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

// ========== Worker Types ==========

export type WorkerStatus = 'pending' | 'running' | 'success' | 'failed' | 'retrying';

export interface WorkerResult {
  workerId: string;
  status: WorkerStatus;
  response: string;
  toolsExecuted: Array<{
    toolName: string;
    args: Record<string, any>;
    result: any;
    timestamp: number;
  }>;
  validation: {
    passed: boolean;
    score: number;
    iterations: number;
    feedback?: string;
    guidelinesCriteria: string[]; // IDs of guidelines used for validation
  };
  metadata: {
    executionTimeMs: number;
    activatedGuidelines: string[];
  };
  error?: string;
}

export interface WorkerExecutionContext {
  userMessage: string;
  messages: LLMMessage[];
  activeGuidelines: GuidelineMatch[];
  task: PlanTask;
  uid: string;
  userPhone: string;
  userName?: string;
  planContext?: ActionPlan; // Full plan for context awareness
  previousTaskResults?: Map<string, string>; // Results from previous tasks in the plan
  contextVariables?: Record<string, string>; // Context variables loaded in the workflow (fecha, nombre_usuario, etc.)
}

// ========== Validation Types ==========

/**
 * Lightweight validation result - simple score + feedback
 * Used by the new simplified validator
 */
export interface LightweightValidationResult {
  score: number;      // 0-10, >= 7 means valid
  isValid: boolean;   // score >= threshold
  feedback?: string;  // If score < 7, describes what tool to execute with what params
}

export interface ValidationCriterion {
  name: string;
  description: string;
  weight: number;
  examples?: string[];
}

export interface GuidelineValidationConfig {
  guidelineIds: string[];
  criteria: ValidationCriterion[];
  threshold: number;
  maxRetries: number;
}

// Legacy ValidationResult - kept for backwards compatibility
export interface ValidationResult extends MicroAgentEvaluationResult {
  criteriaResults: Array<{
    criterionName: string;
    passed: boolean;
    weight: number;
    feedback?: string;
  }>;
}

// ========== Writer Types ==========

export interface WriterInput {
  userMessage: string;
  messages: LLMMessage[];
  activeGuidelines: GuidelineMatch[];
  workerResults: WorkerResult[];
  plan: ActionPlan;
  glossaryContext?: string;
  ragContext?: any;
  contextVariables?: Record<string, string>; // Context variables from workflow (fecha, nombre_usuario, etc.)
}

export interface WriterOutput {
  response: string;
  metadata: {
    usedWorkerResults: string[];
    executionTimeMs: number;
  };
}

// ========== Style Validation Types ==========

export interface StyleValidationCriteria {
  toneCheck: boolean;
  markdownValid: boolean;
  securityCheck: boolean; // No sensitive data exposed
  lengthAppropriate: boolean;
  emojiUsage: 'appropriate' | 'excessive' | 'missing';
}

export interface StyleValidationResult {
  passed: boolean;
  score: number;
  criteria: StyleValidationCriteria;
  feedback: string;
  suggestions: string[];
  shouldRegenerate: boolean;
}

// ========== Cascade Orchestrator Types ==========

export interface CascadeExecutionResult {
  success: boolean;
  response: string;
  metadata: {
    classification: ClassificationResult;
    plan?: ActionPlan;
    workerResults: WorkerResult[];
    writerIterations: number;
    styleValidationPassed: boolean;
    totalExecutionTimeMs: number;
    executedGuidelines: string[];
  };
  error?: string;
}

export interface CascadeConfig {
  maxWorkerRetries: number;
  maxWriterRetries: number;
  workerTimeout: number;
  parallelExecution: boolean;
  criticalPathEnabled: boolean;
  styleValidationEnabled: boolean;
}

// ========== Worker Registry Types ==========

export interface WorkerDefinition {
  id: string;
  name: string;
  description: string;
  associatedGuidelineIds: string[];
  toolNames: string[];
  validationThreshold: number;
  maxRetries: number;
  enabled: boolean;
}

export const WORKER_REGISTRY: WorkerDefinition[] = [
  {
    id: 'search_worker',
    name: 'Property Search Worker',
    description: 'Handles property search and information retrieval',
    associatedGuidelineIds: [
      'search_properties',
      'get_property_detail',
      'show_photos',
      'show_interest',
      'property_reference_context',
      'no_results_fallback'
    ],
    toolNames: ['search_properties', 'get_property_info'],
    validationThreshold: 7.0,
    maxRetries: 2,
    enabled: true
  },
  {
    id: 'visit_worker',
    name: 'Visit Management Worker',
    description: 'Handles visit scheduling, cancellation, and rescheduling',
    associatedGuidelineIds: [
      'query_visit_availability_only',
      'collect_visit_details_missing_property',
      'collect_visit_details_missing_datetime',
      'schedule_visit_join_existing_slot',
      'schedule_visit_request_new_slot',
      'notify_user_owner_confirmed_availability',
      'create_visit_after_both_confirmations',
      'user_declines_after_owner_confirmation',
      'cancel_visit',
      'reschedule_visit',
      'check_visit_status'
    ],
    toolNames: [
      'get_availability',
      'create_visit',
      'add_visitor',
      'cancel_visit',
      'reschedule_visit',
      'ask_availability',
      'get_visit_status'
    ],
    validationThreshold: 7.0,
    maxRetries: 2,
    enabled: true
  },
  {
    id: 'support_worker',
    name: 'Support Escalation Worker',
    description: 'Handles escalation to human agents and sensitive topics',
    associatedGuidelineIds: [
      'get_human_help',
      'price_negotiation_escalation',
      'handle_selling_inquiry'
    ],
    toolNames: ['get_help'],
    validationThreshold: 8.0, // Higher threshold for support
    maxRetries: 1, // Less retries, escalate quickly
    enabled: true
  },
  {
    id: 'feedback_worker',
    name: 'Feedback Collection Worker',
    description: 'Handles feedback collection and logging',
    associatedGuidelineIds: [
      'collect_feedback',
      'save_feedback'
    ],
    toolNames: ['log_feedback'],
    validationThreshold: 6.0,
    maxRetries: 2,
    enabled: true
  },
  {
    id: 'context_worker',
    name: 'Context Search Worker',
    description: 'Handles RAG context search from user documents',
    associatedGuidelineIds: ['context_search'],
    toolNames: ['search_context'],
    validationThreshold: 6.0,
    maxRetries: 1,
    enabled: true
  },
  {
    id: 'reminder_worker',
    name: 'Reminder Worker',
    description: 'Handles reminder creation',
    associatedGuidelineIds: ['create_reminder'],
    toolNames: ['create_reminder'],
    validationThreshold: 7.0,
    maxRetries: 2,
    enabled: true
  }
];

/**
 * Helper to find worker definition by guideline ID
 */
export function findWorkerForGuideline(guidelineId: string): WorkerDefinition | undefined {
  return WORKER_REGISTRY.find(w => 
    w.enabled && w.associatedGuidelineIds.includes(guidelineId)
  );
}

/**
 * Helper to get all workers that should activate for given guidelines
 */
export function getActiveWorkers(guidelineIds: string[]): WorkerDefinition[] {
  const activeWorkers = new Set<WorkerDefinition>();
  
  for (const guidelineId of guidelineIds) {
    const worker = findWorkerForGuideline(guidelineId);
    if (worker) {
      activeWorkers.add(worker);
    }
  }
  
  return Array.from(activeWorkers);
}

