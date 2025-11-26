import { generateText, streamText, tool, stepCountIs, generateObject } from 'ai';
import { ChainOfThoughtAgent } from '../micro-agents/chain-of-thought-agent';
import { GuidelineAgent } from '../guideline-agent';
import { getModel } from '../openrouter';
import { AI_CONFIG } from '../config';
import { z } from 'zod';
import type { GuidelineMatch } from '../types/guideline';
import type { ConversationContext } from '../types/context';
import type { ToolResult } from '../types/tool';
import type { ValidationFeedback } from '../types/validation';
import type { MicroAgentResult } from '../types/micro-agent-types';
import {
  extractToolCallsFromSteps,
  mergeExecutionHistory,
  type ToolExecutionRecord
} from '../utils/tool-call-extractor';
import type { ContextSearchResult } from '../micro-agents/context-search-agent';

// Type helper for tools
type ToolSet = Record<string, ReturnType<typeof tool>>;

export interface ComposerOptions {
  model?: any;
  streaming?: boolean;
  maxTokens?: number;
  temperature?: number;
  enableSelfCritique?: boolean;
  enableValidation?: boolean;
}

export interface ValidationResult {
  score: number;           // 0-10 score
  isValid: boolean;        // true if score >= threshold
  feedback: string;        // Detailed feedback from critic
  issues: string[];        // List of specific issues found
  suggestions: string[];   // Improvement suggestions
  toolsToReExecute?: string[]; // Tools that need to be re-executed (optional)
}

export interface MessageComposerResult {
  text: string;
  toolCalls: any[]; // Assuming 'any' for tool calls structure from 'ai' SDK
  metadata: {
    attempts: number;
    validationScore: number;
    validationFeedback: ValidationFeedback[];
    chainOfThoughtUsed: string | null;
  };
}

// Zod schema for validation result
const validationResultSchema = z.object({
  score: z.number().min(0).max(10).describe('Score between 0-10 evaluating the response quality'),
  is_valid: z.boolean().describe('Whether the score meets the minimum threshold'),
  feedback: z.string().describe('General feedback explaining the score in 2-3 sentences'),
  issues: z.array(z.string()).describe('List of specific issues found in the response'),
  suggestions: z.array(z.string()).describe('Concrete suggestions for improvement'),
  tools_to_reexecute: z.array(z.string()).optional().describe('Names of tools that need to be executed again with different parameters')
});

export class MessageComposer {
  private defaultModel = getModel(AI_CONFIG?.COMPOSER_MODEL_HIGH ?? 'openai/gpt-oss-120b');
  private options: ComposerOptions;

  constructor(options: ComposerOptions = {}) {
    this.options = {
      streaming: false,
      maxTokens: 2000,
      temperature: 1,
      enableSelfCritique: AI_CONFIG?.ENABLE_CRITIQUE ?? false,
      enableValidation: AI_CONFIG?.ENABLE_VALIDATION ?? true,
      ...options
    };
  }

  // Determine model based on highest difficulty of active guidelines
  private selectModelByDifficulty(activeGuidelines: GuidelineMatch[]): any {
    // Find the highest difficulty among active guidelines
    let maxDifficulty: 'low' | 'medium' | 'high' = 'low';
    
    for (const match of activeGuidelines) {
      const difficulty = match.guideline.difficulty || 'medium';
      if (difficulty === 'high') {
        maxDifficulty = 'high';
        break; // High is the maximum, no need to continue
      } else if (difficulty === 'medium' && maxDifficulty === 'low') {
        maxDifficulty = 'medium';
      }
    }

    // Select model based on difficulty
    let selectedModel: string;
    switch (maxDifficulty) {
      case 'high':
        selectedModel = AI_CONFIG.COMPOSER_MODEL_HIGH;
        break;
      case 'medium':
        selectedModel = AI_CONFIG.COMPOSER_MODEL_MEDIUM;
        break;
      case 'low':
      default:
        selectedModel = AI_CONFIG.COMPOSER_MODEL_LOW;
        break;
    }

    console.log(`[MessageComposer] Selected model for difficulty '${maxDifficulty}': ${selectedModel}`);
    return [getModel(selectedModel), maxDifficulty];
  }

  // Generate final response
  async compose(
    conversationContext: ConversationContext,
    guidelines: GuidelineMatch[],
    glossaryContext: string,
    availableTools: Record<string, any>, // Changed from any[] to Record
    toolResults: ToolResult[],
    contextVariables: Record<string, any>,
    executionContextSummary: string | null,
    microAgentsContext: string | null,
    chainOfThought: string | null,
    ragContext: ContextSearchResult | null = null
  ): Promise<MessageComposerResult> {
    console.log('[MessageComposer] Composing message...');

    const [model, difficulty] = this.selectModelByDifficulty(guidelines);
    
    // Track chain of thought history for modifications
    const chainOfThoughtHistory: string[] = [];
    if (chainOfThought) {
      chainOfThoughtHistory.push(chainOfThought);
    }
    
    let currentChainOfThought = chainOfThought;
    let currentSystemPrompt = '';
    let lastResponse = '';
    let validationFeedback: ValidationFeedback[] = [];
    let toolExecutionHistory: ToolExecutionRecord[] = []; // Track tool execution across all attempts
    let hasAlreadyRefined = false; // Track if we already did a refinement pass

    // Main generation loop with validation and CoT modification
    for (let attempt = 1; attempt <= AI_CONFIG.VALIDATION_MAX_RETRIES + 1; attempt++) {
      console.log(`[MessageComposer] Generation attempt ${attempt}/${AI_CONFIG.VALIDATION_MAX_RETRIES + 1}`);
      
      // Build system prompt with minimal context + CoT + validation feedback
      const previousFeedback = validationFeedback.length > 0 ? validationFeedback[validationFeedback.length - 1] : null;
      currentSystemPrompt = this.buildSystemPrompt(
        conversationContext,
        guidelines,
        contextVariables,
        currentChainOfThought,
        toolResults,
        microAgentsContext,
        previousFeedback,
        ragContext
      );

      console.log(`[MessageComposer] Current system prompt: ${currentSystemPrompt}`);

      console.log(`[MessageComposer] Current system prompt length: ${currentSystemPrompt.length}`);

      // Build message history for context
      const messageHistory = conversationContext.messages
        .map(m => `<${m.role}>${m.content}</${m.role}>`)
        .join('\n');


      const toolNames = Object.keys(availableTools);
      console.log(`[MessageComposer] Available tools count: ${toolNames.length}`);
      console.log(`[MessageComposer] Available tool names: ${toolNames.join(', ')}`);

      console.log('[MessageComposer] Calling generateText with:');
      console.log(`  - Model: ${model}`);
      console.log(`  - Tools: ${toolNames.length > 0 ? toolNames.join(', ') : 'none'}`);
      console.log(`  - System prompt length: ${currentSystemPrompt.length}`);
      console.log(`  - User prompt length: ${messageHistory.length}`);

      let toolCalls: any[] = []; // Declare outside try block

      try {
        const response = await generateText({
          model: model,
          system: currentSystemPrompt,
          messages: conversationContext.messages,
          tools: toolNames.length > 0 ? availableTools : undefined, // Pass tools Record directly
          stopWhen: stepCountIs(5)
        });

        console.log('[MessageComposer] Response received:');
        console.log(`  - Text length: ${response.text?.length || 0}`);
        console.log(`  - Tool calls: ${response.toolCalls?.length || 0}`);

        console.log('[MessageComposer] Response text:', response.text);

        lastResponse = response.text;

        if(difficulty === 'low') {
          return {
            text: response.text,
            toolCalls: response.toolCalls,
            metadata: {
              attempts: attempt,
              validationScore: 10,
              validationFeedback: [],
              chainOfThoughtUsed: currentChainOfThought
            }
          }
        }

        // Extract tool calls from steps (AI SDK v5) - handles both direct toolCalls and steps
        const extractedData = await extractToolCallsFromSteps(response, attempt);

        // Merge with global execution history
        toolExecutionHistory = mergeExecutionHistory(toolExecutionHistory, extractedData.executionHistory);

        // Keep direct toolCalls for backward compatibility
        toolCalls = response.toolCalls || [];

        // Log tool execution details
        if (extractedData.currentResults.length > 0) {
          console.log(`[MessageComposer] Extracted ${extractedData.currentResults.length} tool execution(s) from steps in attempt ${attempt}:`);
          extractedData.currentResults.forEach(result => {
            console.log(`  - ${result.toolName}: ${result.result ? 'executed' : 'no result'}`);
          });
        }

        if (toolCalls.length > 0) {
          console.log(`[MessageComposer] Direct tool calls detected: ${toolCalls.length}`);
          toolCalls.forEach(tc => console.log(`  - ${tc.toolName}`));
        }

        // Log cumulative execution history
        if (toolExecutionHistory.length > 0) {
          console.log(`[MessageComposer] Total tools executed across all attempts: ${toolExecutionHistory.length}`);
        }
      } catch (error) {
        console.error('[MessageComposer] Error in generateText:', error);
        throw error;
      }
      
      // Validate text response
      console.log('[MessageComposer] Validating response...');
      const userMessage = conversationContext.messages[conversationContext.messages.length - 1].content;
      console.log('[MessageComposer] User message:', userMessage);
      const validationResult = await this.validateResponse(
        lastResponse,
        guidelines,
        userMessage,
        conversationContext,
        contextVariables,
        toolExecutionHistory,
        toolNames
      );
      
      console.log(`[MessageComposer] Validation score: ${validationResult.score}/10`);
      
      // If valid and no tools to re-execute
      if (validationResult.isValid && (validationResult.toolsToReExecute ?? []).length === 0) {
        // Check if there are suggestions and we have retries left for a refinement pass
        // Only refine once to avoid infinite refinement loops
        const hasSuggestions = validationResult.suggestions && validationResult.suggestions.length > 0;
        const canRefine = !hasAlreadyRefined && attempt <= AI_CONFIG.VALIDATION_MAX_RETRIES && hasSuggestions;
        
        if (canRefine) {
          console.log('[MessageComposer] Response valid but has suggestions. Running refinement pass...');
          hasAlreadyRefined = true; // Mark that we're doing a refinement
          
          // Create refinement feedback with only suggestions
          const refinementFeedback: ValidationFeedback = {
            attempt,
            score: validationResult.score,
            feedback: 'Respuesta válida. Aplica las siguientes mejoras menores al mensaje anterior:',
            issues: [],
            suggestions: validationResult.suggestions,
            previousResponse: lastResponse // Store previous response for refinement
          };
          validationFeedback.push(refinementFeedback);
          
          // Continue to next iteration for refinement
          // The buildSystemPrompt will receive the refinementFeedback with previousResponse
        } else {
          // No suggestions or no retries left, return as is
          return {
            text: lastResponse,
            toolCalls: [],
            metadata: {
              attempts: attempt,
              validationScore: validationResult.score,
              validationFeedback: validationFeedback,
              chainOfThoughtUsed: currentChainOfThought
            }
          };
        }
      } else if (attempt <= AI_CONFIG.VALIDATION_MAX_RETRIES) {
        // If invalid and we have retries left, modify Chain of Thought
        console.log('[MessageComposer] Response invalid. Modifying Chain of Thought...');
        
        const feedback: ValidationFeedback = {
          attempt,
          score: validationResult.score,
          feedback: validationResult.feedback,
          issues: validationResult.issues,
          suggestions: validationResult.suggestions
        };
        validationFeedback.push(feedback);
        
        if (currentChainOfThought) {
          currentChainOfThought = await this.modifyChainOfThought(
            currentChainOfThought,
            feedback,
            conversationContext
          );
          chainOfThoughtHistory.push(currentChainOfThought);
          console.log('[MessageComposer] Chain of Thought modified.');
        } else {
          console.log('[MessageComposer] No Chain of Thought to modify. Skipping retry.');
          break;
        }
      }
    }
    
    // If we exhausted retries, return best effort
    console.log('[MessageComposer] Exhausted retries. Returning last response.');
    return {
      text: lastResponse,
      toolCalls: [],
      metadata: {
        attempts: AI_CONFIG.VALIDATION_MAX_RETRIES + 1,
        validationScore: validationFeedback[validationFeedback.length - 1]?.score || 0,
        validationFeedback: validationFeedback,
        chainOfThoughtUsed: currentChainOfThought
      }
    };
  }

  /**
   * Modifies the Chain of Thought based on validation feedback
   */
  private async modifyChainOfThought(
    originalCoT: string,
    feedback: ValidationFeedback,
    context: ConversationContext
  ): Promise<string> {
    const modifierPrompt = `<task>
You are an expert AI reasoning optimizer. Your goal is to improve a "Chain of Thought" (CoT) plan based on validation feedback from a failed execution.

<original_cot>
${originalCoT}
</original_cot>

<validation_feedback>
Score: ${feedback.score}/10
General Feedback: ${feedback.feedback}
Issues:
${feedback.issues.map(i => `- ${i}`).join('\n')}
Suggestions:
${feedback.suggestions.map(s => `- ${s}`).join('\n')}
</validation_feedback>

<instructions>
1. Analyze why the original CoT led to an invalid response.
2. Modify the CoT to explicitly address the issues and incorporate suggestions.
3. Keep the same XML structure (<thinking>, <step>, etc.) but update the content.
4. Ensure the new plan is robust and will lead to a valid response.
5. Return ONLY the modified Chain of Thought XML.
</instructions>
</task>`;

    try {
      const result = await generateText({
        model: getModel(AI_CONFIG.COMPOSER_MODEL_HIGH), // Use high intelligence for CoT modification
        prompt: modifierPrompt,
        maxOutputTokens: 2000,
        temperature: 0.5
      });

      // Clean markdown code fences from response
      let newCoT = result.text
        .replace(/```xml\n?/g, '')  // Remove ```xml
        .replace(/```\n?/g, '')      // Remove closing ```
        .trim();

      console.log('[MessageComposer] Modified CoT (cleaned):', newCoT.substring(0, 200) + '...');

      return newCoT;
    } catch (error) {
      console.error('[MessageComposer] Error modifying Chain of Thought:', error);
      return originalCoT; // Fallback to original if modification fails
    }
  }

  // Build system prompt with active guidelines (XML version)
private buildSystemPrompt(
  conversationContext: ConversationContext,
  guidelines: GuidelineMatch[],
  contextVariables: Record<string, any>,
  chainOfThought: string | null,
  toolResults: ToolResult[],
  microAgentsContext: string | null,
  validationFeedback: ValidationFeedback | null = null,
  ragContext: ContextSearchResult | null = null
): string {

  let xml = ``;

  xml += `  <sistema>\n`;
  xml += `    <rol>Eres un asistente inmobiliario que atiende vía WhatsApp al interesado</rol>\n`;
  xml += `    <estilo>Breve, natural, profesional (español argentino)</estilo>\n`;
  xml += `  </sistema>\n`;

   // =============================
  // INSTRUCCIONES (Behavior Instructions)
  // =============================
  xml += `  <instrucciones>\n`;
  xml += `    <instruccion>Sigue estrictamente el plan de razonamiento proporcionado en <plan></instruccion>\n`;
  xml += `    <instruccion>Sigue estrictamente las correciones y sugerencias del feedback</instruccion>\n`;
  xml += `    <instruccion>Usa las herramientas indicadas en el plan si es necesario</instruccion>\n`;
  xml += `    <instruccion>Pon atención a las correciones hechas por el validador del plan</instruccion>\n`;
  xml += `    <instruccion>Mantener tono natural y conversacional</instruccion>\n`;
  xml += `    <instruccion>Responder SIEMPRE en español argentino profesional</instruccion>\n`;
  xml += `    <instruccion>Responde brevemente y conciso</instruccion>\n`;
  xml += `    <instruccion>No seas repetitivo</instruccion>\n`;
  // xml += `    <instruccion>Si una tool devuelve contenido formateado (ej: @@property_id:XXX@@), mantenerlo igual</instruccion>\n`;
  xml += `    <instruccion>Envía SIEMPRE las imágenes en el mensaje usando el formato Markdown: ![(...image caption/description...)](https://firebasestorage.googleapis.com/...)</instruccion>\n`;
  xml += `  </instrucciones>\n\n`;

  // =============================
  // CONTEXT
  // =============================
  if (contextVariables && Object.keys(contextVariables).length > 0) {
    xml += `  <variables>\n`;
    Object.entries(contextVariables).forEach(([name, value]) => {
      xml += `    <variable nombre="${name}">${value}</variable>\n`;
    });
    xml += `  </variables>\n`;
  }

  // =============================
  // GUIDELINES
  // =============================
  if (guidelines && guidelines.length > 0) {
    // xml += `  <!-- Guidelines disponibles con prioridad -->\n`;
    xml += `  <guidelines_activas>\n`;
    guidelines.forEach((match) => {
      xml += `    <guideline id="${match.guideline.id}" prioridad="${match.guideline.priority}">\n`;
      xml += `      ${match.guideline.action}\n`;
      xml += `    </guideline>\n`;
    });
    xml += `  </guidelines_activas>\n\n`;
  }

  // =============================
  // RAG CONTEXT FROM UPLOADED DOCUMENTS
  // =============================
  if (ragContext && ragContext.contextSummary) {
    xml += `  <contexto_documentos>\n`;
    xml += `    <descripcion>Información relevante encontrada en los documentos de contexto cargados por el usuario. DEBES usar esta información para responder.</descripcion>\n`;
    xml += `    <documentos_consultados>${ragContext.relevantDocuments.join(', ')}</documentos_consultados>\n`;
    xml += `    <resumen>${ragContext.contextSummary}</resumen>\n`;
    xml += `    <instruccion>Usa esta información del documento para responder la consulta del usuario de manera precisa.</instruccion>\n`;
    xml += `  </contexto_documentos>\n\n`;
  }

  // =============================
  // CHAIN OF THOUGHT REASONING
  // =============================
  if (chainOfThought) {
    xml += `  <plan>\n${chainOfThought}\n</plan>\n`;
  }

  // =============================
  // TOOL RESULTS
  // =============================
  if (toolResults && toolResults.length > 0) {
    xml += `  <previous_tool_results>\n`;
    toolResults.forEach(tr => {
      xml += `    <tool name="${tr.toolName}">\n`;
      xml += `      <resultado>\n${JSON.stringify(tr.result, null, 2)}\n</resultado>\n`;
      xml += `    </tool>\n`;
    });
    xml += `  </previous_tool_results>\n\n`;
  }

  // =============================
  // MICRO-AGENTS CONTEXT
  // =============================
  // if (microAgentsContext) {
  //   xml += `  <micro_agents_context>\n${microAgentsContext}\n</micro_agents_context>\n\n`;
  // }

  // if(conversationContext) {
  //   xml += `  <conversation_context>\n${conversationContext.messages.map(m => `<${m.role}>${m.content}</${m.role}>`).join('\n')}\n</conversation_context>\n\n`;
  // }

  // Add validation feedback or refinement instructions
  if (validationFeedback) {
    // Check if this is a refinement pass (valid response with suggestions)
    const isRefinementPass = validationFeedback.previousResponse && validationFeedback.score >= AI_CONFIG.VALIDATION_MIN_SCORE;
    
    if (isRefinementPass) {
      // Refinement mode: only apply suggestions to the previous response
      xml += `  <refinamiento>\n`;
      xml += `    <instruccion_principal>IMPORTANTE: Tu mensaje anterior fue válido. Solo debes aplicar las siguientes mejoras menores. NO cambies la estructura ni el contenido principal.</instruccion_principal>\n`;
      xml += `    <mensaje_anterior>\n${validationFeedback.previousResponse}\n</mensaje_anterior>\n`;
      xml += `    <mejoras_requeridas>\n`;
      validationFeedback.suggestions.forEach(suggestion => {
        xml += `      <mejora>${suggestion}</mejora>\n`;
      });
      xml += `    </mejoras_requeridas>\n`;
      xml += `    <restricciones>\n`;
      xml += `      <restriccion>Mantén el mismo contenido y estructura general</restriccion>\n`;
      xml += `      <restriccion>Solo aplica las mejoras listadas arriba</restriccion>\n`;
      xml += `      <restriccion>No agregues información nueva</restriccion>\n`;
      xml += `      <restriccion>No elimines información importante</restriccion>\n`;
      xml += `    </restricciones>\n`;
      xml += `  </refinamiento>\n\n`;
    } else if (validationFeedback.score < AI_CONFIG.VALIDATION_MIN_SCORE) {
      // Invalid response: show full feedback
      xml += `  <validation_feedback>\n`;
      xml += `    <previous_attempt>${validationFeedback.attempt}</previous_attempt>\n`;
      xml += `    <score>${validationFeedback.score}/10</score>\n`;
      xml += `    <feedback>${validationFeedback.feedback}</feedback>\n`;
      if (validationFeedback.issues && validationFeedback.issues.length > 0) {
        xml += `    <issues>\n`;
        validationFeedback.issues.forEach(issue => {
          xml += `      <issue>${issue}</issue>\n`;
        });
        xml += `    </issues>\n`;
      }
      if (validationFeedback.suggestions && validationFeedback.suggestions.length > 0) {
        xml += `    <suggestions>\n`;
        validationFeedback.suggestions.forEach(suggestion => {
          xml += `      <suggestion>${suggestion}</suggestion>\n`;
        });
        xml += `    </suggestions>\n`;
      }
      xml += `  </validation_feedback>\n\n`;
    }
  }
  // xml += `<prompt>`;

  return xml;
}


  // Self-critique to verify adherence
  private async critique(
    response: string,
    guidelines: GuidelineMatch[]
  ): Promise<{ text: string; compliant: boolean; issues: string[] }> {
    const guidelineText = guidelines
      .map(g => `- ${g.guideline.action}`)
      .join('\n');

    const critiquePrompt = `Evalúa si la siguiente respuesta cumple con las guidelines:

## Guidelines a seguir:
${guidelineText}

## Respuesta generada:
${response}

¿La respuesta sigue todas las guidelines? Identifica cualquier problema.`;

    const { text: critiqueResult } = await generateText({
      model: getModel(AI_CONFIG?.CRITIQUE_MODEL ?? 'openai/gpt-4o-mini') as any, // Lightweight model for critique
      prompt: critiquePrompt
    });

    // Simple analysis of the critique
    const compliant = !critiqueResult.toLowerCase().includes('no cumple') &&
                      !critiqueResult.toLowerCase().includes('violación');

    console.log('[MessageComposer] Critique result:', critiqueResult);

    console.log('[MessageComposer] Compliant:', compliant);

    return {
      text: response,
      compliant,
      issues: compliant ? [] : [critiqueResult]
    };
  }

  // Summarize conversation context (últimos 5 mensajes)
  private summarizeConversation(context: ConversationContext): string {
    const recent = context.messages.slice(-10); // Last 5 messages
    return recent
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');
  }

  // Build validation prompt in XML format with dynamic criteria
  private buildValidationPrompt(
    response: string,
    activeGuidelines: GuidelineMatch[],
    userMessage: string,
    contextVariables: Record<string, string>,
    conversationSummary: string,
    toolExecutionHistory?: Array<{ iteration: number; toolName: string; result: any; timestamp: string }>,
    availableTools?: string[],
  ): string {
    let xml = `<validation_prompt>\n\n`;

    // =============================
    // ROLE & OBJECTIVE
    // =============================
    xml += `  <role>\n`;
    xml += `    <descripcion>Eres un LLM crítico especializado en validar respuestas de asistentes inmobiliarios</descripcion>\n`;
    xml += `    <objetivo>Evaluar la calidad de la respuesta generada según las guidelines activas y criterios específicos</objetivo>\n`;
    xml += `  </role>\n\n`;

    

    // =============================
    // CONVERSATION CONTEXT
    // =============================
    xml += `  <contexto_conversacional>\n`;
    xml += `    <historial_reciente>\n${conversationSummary}\n</historial_reciente>\n`;
    xml += `  </contexto_conversacional>\n\n`;


      // =============================
  // CONTEXT
  // =============================
  if (contextVariables && Object.keys(contextVariables).length > 0) {
    xml += `    <variables>\n`;
    Object.entries(contextVariables).forEach(([name, value]) => {
      xml += `      <variable nombre="${name}">${value}</variable>\n`;
    });
    xml += `    </variables>\n`;
  }
    // =============================
    // USER MESSAGE (último mensaje)
    // =============================
    xml += `  <mensaje_usuario>\n`;
    xml += `    <contenido>${userMessage}</contenido>\n`;
    xml += `  </mensaje_usuario>\n\n`;

    // =============================
    // ACTIVE GUIDELINES
    // =============================
    xml += `  <guidelines_activas>\n`;
    activeGuidelines.forEach((match, idx) => {
      xml += `    <guideline id="${idx + 1}">\n`;
      xml += `      <prioridad>${match.guideline.priority}</prioridad>\n`;
      xml += `      <score_activacion>${match.score.toFixed(2)}</score_activacion>\n`;
      xml += `      <condicion>${match.guideline.condition}</condicion>\n`;
      xml += `      <accion_requerida>${match.guideline.action}</accion_requerida>\n`;
      xml += `    </guideline>\n`;
    });
    xml += `  </guidelines_activas>\n\n`;

    // =============================
    // GENERATED RESPONSE
    // =============================
    xml += `  <respuesta_generada>\n`;
    xml += `    <contenido>${response}</contenido>\n`;
    xml += `  </respuesta_generada>\n\n`;

    // =============================
    // TOOL CALLS & RESULTS (GROUPED BY ITERATION)
    // =============================
    xml += `  <herramientas_ejecutadas>\n`;
    if (toolExecutionHistory && toolExecutionHistory.length > 0) {
      xml += `    <descripcion>Las siguientes herramientas fueron ejecutadas a lo largo de todas las iteraciones. DEBES verificar que la respuesta utilice TODA la información relevante obtenida de estas herramientas.</descripcion>\n\n`;

      // Group tools by iteration
      const toolsByIteration = toolExecutionHistory.reduce((acc, tool) => {
        if (!acc[tool.iteration]) {
          acc[tool.iteration] = [];
        }
        acc[tool.iteration].push(tool);
        return acc;
      }, {} as Record<number, typeof toolExecutionHistory>);

      // Display tools grouped by iteration
      Object.keys(toolsByIteration).sort((a, b) => Number(a) - Number(b)).forEach((iterationNum) => {
        const iteration = Number(iterationNum);
        const tools = toolsByIteration[iteration];

        xml += `    <iteracion numero="${iteration}">\n`;

        tools.forEach((tool) => {
          xml += `      <herramienta>\n`;
          xml += `        <nombre>${tool.toolName}</nombre>\n`;
          xml += `        <resultado>${typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result)}</resultado>\n`;
          xml += `      </herramienta>\n`;
        });

        xml += `    </iteracion>\n\n`;
      });

      xml += `    <criterios_validacion_herramientas>\n`;
      xml += `      <criterio>✓ La respuesta DEBE incorporar los datos obtenidos de TODAS las iteraciones</criterio>\n`;
      xml += `      <criterio>✓ Si se encontraron propiedades (count > 0), la respuesta DEBE mostrarlas con detalles</criterio>\n`;
      xml += `      <criterio>✓ Si hay searchId, la respuesta puede usarlo para referencias futuras</criterio>\n`;
      xml += `      <criterio>✓ Si success=false, la respuesta debe explicar el problema al usuario</criterio>\n`;
      xml += `      <criterio>✓ La respuesta NO debe ignorar información importante de los resultados</criterio>\n`;
      xml += `      <criterio>✗ Si la respuesta solo dice "ejecuté la herramienta" sin mostrar los datos → SCORE BAJO</criterio>\n`;
      xml += `      <criterio>⚠️ IMPORTANTE: Considera los resultados de TODAS las iteraciones, no solo la última</criterio>\n`;
      xml += `    </criterios_validacion_herramientas>\n`;
      xml += `  </herramientas_ejecutadas>\n\n`;
    } else {
      xml += `    <descripcion>No se ejecutaron herramientas durante la generación de esta respuesta.</descripcion>\n`;
      xml += `  </herramientas_ejecutadas>\n\n`;
    }

    // =============================
    // AVAILABLE TOOLS (for tools_to_reexecute)
    // =============================
    if (availableTools && availableTools.length > 0) {
      xml += `  <herramientas_disponibles>\n`;
      xml += `    <descripcion>Lista de herramientas disponibles en el sistema. SOLO puedes sugerir re-ejecutar herramientas de esta lista.</descripcion>\n`;
      xml += `    <lista>\n`;
      availableTools.forEach((toolName, idx) => {
        xml += `      <herramienta id="${idx + 1}">${toolName}</herramienta>\n`;
      });
      xml += `    </lista>\n`;
      xml += `    <restriccion_importante>⚠️ SOLO incluye herramientas de esta lista en "tools_to_reexecute". NO inventes nombres de herramientas que no existen en esta lista.</restriccion_importante>\n`;
      xml += `  </herramientas_disponibles>\n\n`;
    }

    // =============================
    // EVALUATION CRITERIA (Standard + Dynamic)
    // =============================
    xml += `  <criterios_evaluacion>\n`;
    xml += `    <descripcion>Evalúa la respuesta en una escala de 0-10 considerando los siguientes criterios</descripcion>\n\n`;

    // Standard criteria
    // Adjust weights when tools are executed to maintain 100 total
    const hasToolResults = toolExecutionHistory && toolExecutionHistory.length > 0;
    const toolUsageWeight = hasToolResults ? 15 : 0;
    const veracidadWeight = 20; // Critical criterion - always present
    const baseWeights = {
      veracidad: veracidadWeight,
      guidelines: 30,
      relevancia: 25,
      claridad: 20,
      completitud: 15,
      tono: 10
    };
    
    // Redistribute weights when tools are present
    if (hasToolResults) {
      // Reduce other weights to accommodate tool usage (15 points) and veracidad (20 points)
      // Total must be 65 so with tool usage (15) + veracidad (20) = 100
      baseWeights.guidelines = 20;
      baseWeights.relevancia = 17;
      baseWeights.claridad = 14;
      baseWeights.completitud = 9;
      baseWeights.tono = 5;
    } else {
      // Without tools: reduce other weights to accommodate veracidad (20 points)
      // Total must be 80 so with veracidad (20) = 100
      baseWeights.guidelines = 25;
      baseWeights.relevancia = 20;
      baseWeights.claridad = 15;
      baseWeights.completitud = 12;
      baseWeights.tono = 8;
    }
    
    xml += `    <criterios>\n`;
    
    // Critical criterion: Veracidad
    xml += `      <criterio peso="${baseWeights.veracidad}" critico="true">\n`;
    xml += `        <nombre>Veracidad</nombre>\n`;
    xml += `        <regla>NO inventar información. Solo usar datos del contexto, herramientas o conversación.</regla>\n`;
    xml += `        <penalizacion>Si hay CUALQUIER dato inventado → puntaje 0, is_valid: false</penalizacion>\n`;
    xml += `      </criterio>\n`;
    
    // Other criteria
    xml += `      <criterio peso="${baseWeights.guidelines}"><nombre>Guidelines</nombre><regla>Cumple las guidelines activas</regla></criterio>\n`;
    xml += `      <criterio peso="${baseWeights.relevancia}"><nombre>Relevancia</nombre><regla>Responde solamente lo que el usuario preguntó</regla></criterio>\n`;
    xml += `      <criterio peso="${baseWeights.claridad}"><nombre>Claridad</nombre><regla>Respuesta clara, concisa y profesional, sin ser repetitivo</regla></criterio>\n`;
    xml += `      <criterio peso="${baseWeights.completitud}"><nombre>Completitud</nombre><regla>Incluye toda la información necesaria, sin ser repetitivo</regla></criterio>\n`;
    xml += `      <criterio peso="${baseWeights.tono}"><nombre>Tono</nombre><regla>Español argentino con "vos"</regla></criterio>\n`;
    
    // Tool usage criterion (only if tools were executed)
    if (hasToolResults) {
      xml += `      <criterio peso="${toolUsageWeight}"><nombre>Uso de herramientas</nombre><regla>Usa correctamente los datos obtenidos de las herramientas</regla></criterio>\n`;
    }
    
    xml += `    </criterios>\n\n`;

    // Dynamic criteria from guidelines
    const dynamicCriteria = activeGuidelines
      .filter(match => match.guideline.validationCriteria && match.guideline.validationCriteria.length > 0)
      .flatMap(match => match.guideline.validationCriteria!.map(vc => ({ ...vc, guidelineId: match.guideline.id })));

    if (dynamicCriteria.length > 0) {
      xml += `    <criterios_especificos>\n`;
      xml += `      <descripcion>Criterios adicionales específicos para las guidelines activas</descripcion>\n\n`;

      dynamicCriteria.forEach((criterion, idx) => {
        xml += `      <criterio id="${idx + 1}" guideline_id="${criterion.guidelineId}" peso="${criterion.weight}">\n`;
        xml += `        <nombre>${criterion.name}</nombre>\n`;
        xml += `        <descripcion>${criterion.description}</descripcion>\n`;

        if (criterion.examples && criterion.examples.length > 0) {
          xml += `        <ejemplos>\n`;
          criterion.examples.forEach((example, exIdx) => {
            xml += `          <ejemplo id="${exIdx + 1}">${example}</ejemplo>\n`;
          });
          xml += `        </ejemplos>\n`;
        }

        xml += `      </criterio>\n`;
      });

      xml += `    </criterios_especificos>\n\n`;
    }

    xml += `  </criterios_evaluacion>\n\n`;

    // =============================
    // OUTPUT FORMAT
    // =============================
    xml += `  <formato_salida>\n`;
    xml += `    <instruccion>Responde en JSON puro (sin markdown). El score mínimo para is_valid=true es ${AI_CONFIG?.VALIDATION_MIN_SCORE ?? 7}.</instruccion>\n`;
    xml += `    <reglas>\n`;
    xml += `      <regla critica="true">Información inventada → score=0, is_valid=false</regla>\n`;
    xml += `      <regla>tools_to_reexecute: SOLO tools que necesitan re-ejecutarse con otros parámetros. Array vacío si no aplica.</regla>\n`;
    xml += `    </reglas>\n`;
    xml += `  </formato_salida>\n\n`;

    xml += `</validation_prompt>`;

    return xml;
  }

  // Validate response with critic LLM and provide structured feedback
  private async validateResponse(
    response: string,
    activeGuidelines: GuidelineMatch[],
    userMessage: string,
    context: ConversationContext,
    contextVariables: Record<string, string>,
    toolExecutionHistory?: Array<{ iteration: number; toolName: string; result: any; timestamp: string }>,
    availableTools?: string[]
  ): Promise<ValidationResult> {
    // Summarize conversation for context
    const conversationSummary = this.summarizeConversation(context);

    // Build validation prompt in XML format
    const validationPrompt = this.buildValidationPrompt(
      response,
      activeGuidelines,
      userMessage,
      contextVariables,
      conversationSummary,
      toolExecutionHistory,
      availableTools,
    );

    try {
      const critiqueModel = getModel(AI_CONFIG?.CRITIQUE_MODEL ?? 'openai/gpt-4o-mini');
      const { object: validation } = await generateObject({
        model: critiqueModel as any,
        schema: validationResultSchema,
        prompt: validationPrompt,
        temperature: 0.3, // Low temperature for consistent validation
      });

      console.log('[MessageComposer] Validation structured response:', validation);

      const result: ValidationResult = {
        score: validation.score,
        isValid: validation.score >= (AI_CONFIG?.VALIDATION_MIN_SCORE ?? 7),
        feedback: validation.feedback,
        issues: validation.issues,
        suggestions: validation.suggestions,
        toolsToReExecute: validation.tools_to_reexecute || []
      };

      console.log('[MessageComposer] Validation result:', result);

      return result;
    } catch (error) {
      console.error('[MessageComposer] Validation error:', error);
      // Fallback: accept the response if validation fails
      return {
        score: 7,
        isValid: true,
        feedback: 'Validation failed, accepting response by default',
        issues: [],
        suggestions: []
      };
    }
  }
}

