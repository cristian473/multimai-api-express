/**
 * User Simulator
 *
 * Simulates a real user interacting with the Multimai agent
 * Uses gpt-5.1 to generate realistic, contextual responses
 */

import { generateText } from 'ai';
import { getOpenRouterModel } from '../openrouter';
import { AI_CONFIG } from '../config';
import type { ConversationScenario } from '../scenarios';

export interface UserProfile {
  name: string;
  personality: ConversationScenario['userPersonality'];
  goal: string;
  context: string;
  communicationStyle: string;
}

export interface UserSimulatorConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class UserSimulator {
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private profile: UserProfile | null = null;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  constructor(config?: UserSimulatorConfig) {
    this.model = config?.model || AI_CONFIG.AUTO_DEV.SYNTHETIC_USER_MODEL;
    this.temperature = config?.temperature || 0.9; // Higher for more varied responses
    this.maxTokens = config?.maxTokens || 300;
  }

  /**
   * Initialize simulator with a scenario
   */
  async initializeFromScenario(scenario: ConversationScenario): Promise<void> {
    // Generate user profile based on scenario
    const { text: profileJson } = await generateText({
      model: getOpenRouterModel(this.model),
      temperature: 0.7,
      maxOutputTokens: 500,
      prompt: `Genera un perfil de usuario realista para este escenario de conversación inmobiliaria.

ESCENARIO:
- Objetivo: ${scenario.userGoal}
- Personalidad: ${scenario.userPersonality}
- Dificultad: ${scenario.difficulty}

Genera un JSON con este formato:
{
  "name": "Nombre argentino realista",
  "context": "Contexto personal (ej: se muda por trabajo, busca para familia, etc.)",
  "communicationStyle": "Descripción de cómo se comunica este usuario específico"
}

Retorna SOLO el JSON sin markdown.`
    });

    try {
      const parsed = JSON.parse(profileJson.trim());
      this.profile = {
        ...parsed,
        personality: scenario.userPersonality,
        goal: scenario.userGoal
      };
      this.conversationHistory = [];
    } catch (error) {
      console.error('[UserSimulator] Error parsing profile:', error);
      // Fallback to basic profile
      this.profile = {
        name: 'Usuario Test',
        personality: scenario.userPersonality,
        goal: scenario.userGoal,
        context: 'Usuario buscando propiedad',
        communicationStyle: 'Comunicación estándar'
      };
    }
  }

  /**
   * Generate user's initial message to start conversation
   */
  async generateInitialMessage(): Promise<string> {
    if (!this.profile) {
      throw new Error('UserSimulator not initialized. Call initializeFromScenario first.');
    }

    const { text } = await generateText({
      model: getOpenRouterModel(this.model),
      temperature: this.temperature,
      maxOutputTokens: this.maxTokens,
      prompt: `Eres un usuario argentino que contacta a una inmobiliaria por WhatsApp.

TU PERFIL:
- Nombre: ${this.profile.name}
- Objetivo: ${this.profile.goal}
- Personalidad: ${this.profile.personality}
- Contexto: ${this.profile.context}
- Estilo: ${this.profile.communicationStyle}

INSTRUCCIONES:
- Escribe el PRIMER mensaje que enviarías al agente inmobiliario
- Usa lenguaje natural argentino (vos, che, etc. si es casual)
- Sé ${this.profile.personality === 'urgent' ? 'directo y urgente' : this.profile.personality === 'detailed' ? 'detallado' : this.profile.personality === 'confused' ? 'un poco confuso' : this.profile.personality === 'formal' ? 'formal y educado' : this.profile.personality === 'frustrated' ? 'frustrado pero educado' : 'casual y amigable'}
- NO uses emojis excesivamente
- Longitud: 1-3 oraciones

Retorna SOLO el mensaje, sin comillas, sin prefijos.`
    });

    const message = text.trim();
    this.conversationHistory.push({ role: 'user', content: message });
    return message;
  }

  /**
   * Generate user's response to agent's message
   */
  async generateResponse(agentMessage: string, turnNumber: number): Promise<string> {
    if (!this.profile) {
      throw new Error('UserSimulator not initialized. Call initializeFromScenario first.');
    }

    this.conversationHistory.push({ role: 'assistant', content: agentMessage });

    // Determine if user should end conversation
    const shouldEnd = turnNumber >= 8 || this.shouldEndConversation(agentMessage);

    const { text } = await generateText({
      model: getOpenRouterModel(this.model),
      temperature: this.temperature,
      maxOutputTokens: this.maxTokens,
      prompt: `Eres un usuario argentino conversando con un agente inmobiliario por WhatsApp.

TU PERFIL:
- Nombre: ${this.profile.name}
- Objetivo original: ${this.profile.goal}
- Personalidad: ${this.profile.personality}
- Estilo: ${this.profile.communicationStyle}

HISTORIAL DE CONVERSACIÓN:
${this.conversationHistory.map(m => `${m.role === 'user' ? 'TÚ' : 'AGENTE'}: ${m.content}`).join('\n')}

EL AGENTE ACABA DE DECIR:
"${agentMessage}"

INSTRUCCIONES:
${shouldEnd ?
  '- Esta es tu ÚLTIMA respuesta. Despedite educadamente o confirma lo que el agente te propuso.' :
  '- Continúa la conversación naturalmente hacia tu objetivo: ' + this.profile.goal}
- Mantén tu personalidad: ${this.profile.personality}
- Responde de forma realista como lo haría un usuario real
- Si el agente te pide información, proporciónala de forma natural
- Si el agente te ofrece algo que resuelve tu objetivo, acéptalo
- Si algo no está claro, pregunta
- NO uses emojis excesivamente
- Longitud: 1-3 oraciones

Retorna SOLO tu respuesta, sin comillas, sin prefijos.`
    });

    const message = text.trim();

    // Detect special end markers
    if (message.toLowerCase().includes('[end]') ||
        message.toLowerCase().includes('gracias') && message.toLowerCase().includes('adiós')) {
      return '[END_CONVERSATION]';
    }

    this.conversationHistory.push({ role: 'user', content: message });
    return message;
  }

  /**
   * Check if conversation should end based on agent's message
   */
  private shouldEndConversation(agentMessage: string): boolean {
    const agentLower = agentMessage.toLowerCase();

    // End if agent confirmed something successfully
    if (agentLower.includes('confirmado') ||
        agentLower.includes('agendado') ||
        agentLower.includes('registrado') ||
        agentLower.includes('listo')) {
      return true;
    }

    // End if agent asked for help/escalated
    if (agentLower.includes('consulté') ||
        agentLower.includes('le avisé') ||
        agentLower.includes('te contactará')) {
      return true;
    }

    return false;
  }

  /**
   * Get conversation history
   */
  getHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return [...this.conversationHistory];
  }

  /**
   * Get user profile
   */
  getProfile(): UserProfile | null {
    return this.profile;
  }

  /**
   * Reset simulator for new conversation
   */
  reset(): void {
    this.profile = null;
    this.conversationHistory = [];
  }
}
