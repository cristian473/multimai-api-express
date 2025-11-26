/**
 * Main exports for the Guideline Agent System
 */

// Core components
export { GlossaryStore } from './core/glossary-store';
export { GuidelineMatcher } from './core/guideline-matcher';
export { ToolOrchestrator } from './core/tool-orchestrator';
export { MessageComposer } from './core/message-composer';

// Main agent class
export { GuidelineAgent } from './guideline-agent';
export type { GuidelineAgentOptions } from './guideline-agent';

// Types
export type { Guideline, GuidelineMatch } from './types/guideline';
export type { ConversationContext, AgentState, ContextVariable } from './types/context';
export { GuidelineSchema } from './types/guideline';

// Guidelines and glossary
export { multimaiGuidelines } from './guidelines/multimai-guidelines';
export { realEstateGlossary } from './glossary/real-estate-terms';

// Configuration
export { AI_CONFIG } from './config';
export type { AIConfig } from './config';

// Workflow
export { mainGuidelinesWorkflow, mainWorkflow } from './workflows/main-guidelines-workflow';
export type { WorkflowResult } from './workflows/main-guidelines-workflow';

// Tools (re-export from tools/index.ts)
export {
  searchPropertiesRAGTool,
  getPropertyInfoTool,
  getTodayDateTool,
  getAvailabilityToVisitPropertyTool,
  createNewPropertyVisitTool,
  addVisitorToScheduledVisitTool,
  getHelpTool,
  askForAvailabilityTool,
  schedulePropertyVisitTool,
  cancelVisitTool,
  rescheduleVisitTool,
  logFeedbackTool,
  getSearchResultsCache,
} from './tools';

