import type { GuidelineMatch } from './guideline';

// Conversational context
export interface ConversationContext {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  userId?: string;
  sessionId: string;
  metadata?: Record<string, any>;
  toolResults?: Array<{
    toolName: string;
    result: any;
  }>;
}

// Context variable definition
export interface ContextVariable {
  name: string;
  value: string | (() => string) | (() => Promise<string>);
  description?: string;
}

// Agent state
export interface AgentState {
  context: ConversationContext;
  activeGuidelines: GuidelineMatch[];
  glossaryTerms: string[];
  conversationPhase: 'greeting' | 'discovery' | 'execution' | 'closing';
  contextVariables?: Record<string, string>;
}

