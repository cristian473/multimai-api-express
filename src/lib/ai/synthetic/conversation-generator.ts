/**
 * Conversation Generator
 *
 * Orchestrates synthetic conversations between UserSimulator and Multimai agent
 */

import { UserSimulator } from './user-simulator';
import { mainGuidelinesWorkflow } from '../workflows/main-guidelines-workflow';
import type { ConversationScenario } from '../scenarios';

export interface SyntheticMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    selectedGuidelines?: string[];
    executedAgents?: number;
    errors?: string;
  };
}

export interface SyntheticConversation {
  id: string;
  synthetic: true;
  scenario: ConversationScenario;
  userProfile: {
    name: string;
    personality: string;
    goal: string;
  };
  messages: SyntheticMessage[];
  outcome: {
    success: boolean;
    reason: string;
    guidelinesActivated: string[];
    toolsAttempted: string[];
  };
  metadata: {
    duration: number; // milliseconds
    turnCount: number;
    completedAt: Date;
  };
}

export class ConversationGenerator {
  private uid: string;
  private maxTurns: number;

  constructor(uid: string, maxTurns: number = 6) {
    this.uid = uid;
    this.maxTurns = maxTurns; // Reduced from 10 to 6 for faster generation
  }

  /**
   * Generate a complete synthetic conversation for a scenario
   */
  async generateConversation(scenario: ConversationScenario): Promise<SyntheticConversation> {
    const startTime = Date.now();
    const conversationId = `synthetic_${Date.now()}_${scenario.id}`;
    const session = `synthetic_session_${Date.now()}`;
    const userPhone = `synthetic_${scenario.id}`;

    console.error(`\n[ConversationGenerator] Starting scenario: ${scenario.id}`);
    console.error(`[ConversationGenerator] Goal: ${scenario.userGoal}`);

    // Initialize user simulator
    const simulator = new UserSimulator();
    await simulator.initializeFromScenario(scenario);
    const userProfile = simulator.getProfile();

    if (!userProfile) {
      throw new Error('Failed to initialize user profile');
    }

    const messages: SyntheticMessage[] = [];
    const guidelinesActivated = new Set<string>();
    const toolsAttempted = new Set<string>();
    let success = false;
    let endReason = 'max_turns_reached';

    // Generate initial user message
    const initialMessage = await simulator.generateInitialMessage();
    messages.push({
      role: 'user',
      content: initialMessage,
      timestamp: new Date()
    });

    console.error(`[ConversationGenerator] User: ${initialMessage.substring(0, 80)}...`);

    // Conversation loop
    for (let turn = 0; turn < this.maxTurns; turn++) {
      try {
        // Get agent response
        const agentResult = await mainGuidelinesWorkflow(this.uid, session, {
          userPhone,
          message: messages[messages.length - 1].content,
          userName: userProfile.name
        });

        if (!agentResult) {
          console.error(`[ConversationGenerator] Agent returned null on turn ${turn + 1}`);
          endReason = 'agent_error';
          break;
        }

        // Track guidelines and tools
        if (agentResult.metadata?.selectedGuidelines) {
          agentResult.metadata.selectedGuidelines.forEach(g => guidelinesActivated.add(g));
        }

        messages.push({
          role: 'assistant',
          content: agentResult.message,
          timestamp: new Date(),
          metadata: agentResult.metadata
        });

        console.error(`[ConversationGenerator] Agent: ${agentResult.message.substring(0, 80)}...`);
        console.error(`[ConversationGenerator] Guidelines: ${agentResult.metadata?.selectedGuidelines?.join(', ') || 'none'}`);

        // Check if conversation should end naturally
        if (this.isConversationComplete(agentResult.message, scenario)) {
          success = true;
          endReason = 'goal_achieved';
          console.error('[ConversationGenerator] Goal achieved!');
          break;
        }

        // Generate user response
        const userResponse = await simulator.generateResponse(agentResult.message, turn);

        if (userResponse === '[END_CONVERSATION]') {
          success = this.evaluateSuccess(messages, scenario);
          endReason = 'user_ended';
          console.error('[ConversationGenerator] User ended conversation');
          break;
        }

        messages.push({
          role: 'user',
          content: userResponse,
          timestamp: new Date()
        });

        console.error(`[ConversationGenerator] User: ${userResponse.substring(0, 80)}...`);

      } catch (error) {
        console.error(`[ConversationGenerator] Error on turn ${turn + 1}:`, error);
        endReason = 'error: ' + String(error);
        break;
      }
    }

    const duration = Date.now() - startTime;

    // Evaluate final outcome
    if (!success && endReason === 'max_turns_reached') {
      success = this.evaluateSuccess(messages, scenario);
    }

    const conversation: SyntheticConversation = {
      id: conversationId,
      synthetic: true,
      scenario,
      userProfile: {
        name: userProfile.name,
        personality: userProfile.personality,
        goal: userProfile.goal
      },
      messages,
      outcome: {
        success,
        reason: endReason,
        guidelinesActivated: Array.from(guidelinesActivated),
        toolsAttempted: Array.from(toolsAttempted)
      },
      metadata: {
        duration,
        turnCount: messages.length,
        completedAt: new Date()
      }
    };

    console.error(`[ConversationGenerator] Completed in ${duration}ms (${messages.length} messages)`);
    console.error(`[ConversationGenerator] Success: ${success} (${endReason})`);

    return conversation;
  }

  /**
   * Check if conversation completed successfully
   */
  private isConversationComplete(agentMessage: string, scenario: ConversationScenario): boolean {
    const messageLower = agentMessage.toLowerCase();

    // Check for success indicators based on scenario category
    switch (scenario.category) {
      case 'search':
        return messageLower.includes('encontr') || messageLower.includes('propiedades');

      case 'visit_scheduling':
        return messageLower.includes('confirmad') || messageLower.includes('agendad') || messageLower.includes('programad');

      case 'owner_escalation':
        return messageLower.includes('consult') || messageLower.includes('avis') || messageLower.includes('contactar');

      case 'visit_management':
        return messageLower.includes('cancelad') || messageLower.includes('reprogramad');

      case 'edge_case':
        // Varies by scenario
        return false;

      default:
        return false;
    }
  }

  /**
   * Evaluate if conversation was successful based on messages
   */
  private evaluateSuccess(messages: SyntheticMessage[], scenario: ConversationScenario): boolean {
    // If scenario shouldn't succeed, check it failed appropriately
    if (!scenario.shouldSucceed) {
      // Check that agent handled failure gracefully
      const lastAgentMessage = messages.filter(m => m.role === 'assistant').pop();
      if (!lastAgentMessage) return false;

      const message = lastAgentMessage.content.toLowerCase();
      return message.includes('lament') ||
             message.includes('disculp') ||
             message.includes('alternativ') ||
             message.includes('ayud');
    }

    // Check if expected guidelines were activated
    const activatedGuidelines = messages
      .filter(m => m.metadata?.selectedGuidelines)
      .flatMap(m => m.metadata!.selectedGuidelines!);

    const hasExpectedGuidelines = scenario.expectedGuidelines.some(expected =>
      activatedGuidelines.includes(expected)
    );

    if (!hasExpectedGuidelines && scenario.expectedGuidelines.length > 0) {
      console.error('[ConversationGenerator] Expected guidelines not activated');
      return false;
    }

    // Check last message indicates success
    const lastAgentMessage = messages.filter(m => m.role === 'assistant').pop();
    if (!lastAgentMessage) return false;

    return this.isConversationComplete(lastAgentMessage.content, scenario);
  }

  /**
   * Generate multiple conversations in parallel
   */
  async generateMultipleConversations(
    scenarios: ConversationScenario[],
    parallel: number = 3
  ): Promise<SyntheticConversation[]> {
    const results: SyntheticConversation[] = [];

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < scenarios.length; i += parallel) {
      const batch = scenarios.slice(i, i + parallel);
      console.error(`\n[ConversationGenerator] Processing batch ${Math.floor(i / parallel) + 1} (${batch.length} scenarios)`);

      const batchResults = await Promise.all(
        batch.map(scenario => this.generateConversation(scenario))
      );

      results.push(...batchResults);
    }

    return results;
  }
}
