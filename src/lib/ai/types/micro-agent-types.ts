import type { Guideline, GuidelineMatch } from './guideline';
import type { ConversationContext } from './context';

/**
 * Configuration for a micro-agent
 */
export interface MicroAgentConfig {
  id: string;
  name: string;
  description: string;
  associatedGuidelineIds: string[];
  toolNames: string[];
  maxIterations: number;
  evaluationThreshold: number; // 0-10 score
  enabled: boolean;
}

/**
 * Result from micro-agent execution
 */
export interface MicroAgentResult {
  agentId: string;
  success: boolean;
  response: string;
  metadata: {
    iterations: number;
    finalScore?: number;
    toolsExecuted: string[];
    executionTimeMs: number;
    activatedGuidelines: string[];
  };
  error?: string;
}

/**
 * Execution context shared between micro-agents
 */
export interface MicroAgentExecutionContext {
  userMessage: string;
  conversationContext: ConversationContext;
  activeGuidelines: GuidelineMatch[]; // Changed from Guideline[] to GuidelineMatch[]
  uid: string;
  userPhone: string;
  userName?: string;
}

/**
 * Evaluation result from micro-agent evaluator
 */
export interface MicroAgentEvaluationResult {
  score: number; // 0-10
  isValid: boolean; // true if score >= threshold
  feedback: string;
  issues: string[];
  suggestions: string[];
  shouldRetry: boolean;
}

/**
 * Iteration state for micro-agent execution loop
 */
export interface MicroAgentIterationState {
  iteration: number;
  response: string;
  evaluationResult?: MicroAgentEvaluationResult;
  toolsExecuted: string[];
}
