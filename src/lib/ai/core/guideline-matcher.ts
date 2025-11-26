import { generateObject, generateText } from 'ai';
import { groq } from '@ai-sdk/groq';
import { z } from 'zod';
import type { Guideline, GuidelineMatch } from '../types/guideline';
import type { ConversationContext } from '../types/context';
import { AI_CONFIG } from '../config';
import { getModel, getOpenRouterModel } from '../openrouter';

export class GuidelineMatcher {
  private guidelines: Guideline[] = [];
  // Use Groq SDK as primary provider for semantic guideline matching.
  // Model can be tuned in config via AI_CONFIG.MATCHING_MODEL; falls back to a default Groq model.
  private model = getModel(AI_CONFIG.MATCHING_MODEL || 'openai/gpt-5.1-codex-mini');
  private cache = new Map<string, GuidelineMatch[]>(); // Semantic cache

  constructor(guidelines: Guideline[] = []) {
    this.guidelines = guidelines.filter(g => g.enabled);
  }

  // Add guideline to the system
  addGuideline(guideline: Guideline): void {
    if (guideline.enabled) {
      this.guidelines.push(guideline);
      this.cache.clear(); // Invalidate cache
    }
  }

  // Load multiple guidelines
  loadGuidelines(guidelines: Guideline[]): void {
    this.guidelines = guidelines.filter(g => g.enabled);
    this.cache.clear();
  }

  // Main semantic matching using LLM (optimized with batching)
  async matchGuidelines(
    context: ConversationContext,
    threshold: number = 0.7,
    batchSize: number = 5
  ): Promise<GuidelineMatch[]> {
    // Check cache
    const cacheKey = this.getCacheKey(context);
    if (this.cache.has(cacheKey)) {
      console.log('[GuidelineMatcher] Cache hit for:', cacheKey);
      return this.cache.get(cacheKey)!;
    }

    // Build conversational context
    const conversationSummary = this.summarizeConversation(context);

    console.log(`[GuidelineMatcher] Evaluating ${this.guidelines.length} guidelines in batches of ${batchSize}...`);

    // Group guidelines into batches
    const batches = this.createBatches(this.guidelines, batchSize);
    console.log(`[GuidelineMatcher] Created ${batches.length} batches`);

    // Evaluate each batch in parallel
    const batchPromises = batches.map((batch, index) =>
      this.evaluateBatch(batch, conversationSummary, context, index)
    );

    const batchResults = await Promise.all(batchPromises);

    // Flatten all results
    const results = batchResults.flat();

    // Filter by threshold and sort by score
    const matches = results
      .filter(match => match.score >= threshold)
      .sort((a, b) => {
        // Priority first, then score
        if (a.guideline.priority !== b.guideline.priority) {
          return b.guideline.priority - a.guideline.priority;
        }
        return b.score - a.score;
      });

    console.log(`[GuidelineMatcher] Matched ${matches.length} guidelines above threshold ${threshold}`);
    matches.forEach(m => {
      console.log(`  - ${m.guideline.id} (priority: ${m.guideline.priority}, score: ${m.score.toFixed(2)}): ${m.reason}`);
    });

    // Cache result
    this.cache.set(cacheKey, matches);

    return matches;
  }

  // Create batches of guidelines
  private createBatches(guidelines: Guideline[], batchSize: number): Guideline[][] {
    const batches: Guideline[][] = [];
    for (let i = 0; i < guidelines.length; i += batchSize) {
      batches.push(guidelines.slice(i, i + batchSize));
    }
    return batches;
  }

  // Build evaluation prompt in XML format
  private buildEvaluationPrompt(
    batch: Guideline[],
    conversationSummary: string,
    context: ConversationContext
  ): string {
    let xml = `<evaluation_prompt>\n\n`;

    // =============================
    // ROLE & OBJECTIVE
    // =============================
    xml += `  <role>\n`;
    xml += `    <descripcion>Eres un evaluador semántico especializado en determinar qué guidelines aplican a una conversación</descripcion>\n`;
    xml += `    <objetivo>Analizar el contexto conversacional y evaluar qué guidelines son relevantes según sus condiciones</objetivo>\n`;
    xml += `  </role>\n\n`;

    // =============================
    // GUIDELINES TO EVALUATE
    // =============================
    xml += `  <guidelines_a_evaluar>\n`;
    xml += `    <descripcion>Evalúa cada guideline cuidadosamente y determina si su condición se cumple</descripcion>\n\n`;

    batch.forEach((g, idx) => {
      xml += `    <guideline indice="${idx + 1}">\n`;
      xml += `      <id>${g.id}</id>\n`;
      xml += `      <condicion>${g.condition}</condicion>\n`;
      xml += `      <accion>${g.action}</accion>\n`;
      xml += `      <prioridad>${g.priority}</prioridad>\n`;
      xml += `      <dificultad>${g.difficulty}</dificultad>\n`;
      if (g.tags && g.tags.length > 0) {
        xml += `      <tags>${g.tags.join(', ')}</tags>\n`;
      }
      xml += `    </guideline>\n\n`;
    });

    xml += `  </guidelines_a_evaluar>\n\n`;

    // =============================
    // CONVERSATION CONTEXT
    // =============================
    xml += `  <contexto_conversacional>\n`;
    xml += `    <historial_reciente>\n${conversationSummary}\n</historial_reciente>\n`;
    xml += `  </contexto_conversacional>\n\n`;

    // =============================
    // LAST MESSAGE
    // =============================
    const lastMessage = context.messages[context.messages.length - 1]?.content || 'N/A';
    xml += `  <ultimo_mensaje>\n`;
    xml += `    <contenido>${lastMessage}</contenido>\n`;
    xml += `  </ultimo_mensaje>\n\n`;

    // =============================
    // TOOL RESULTS (if any)
    // =============================
    if (context.toolResults && context.toolResults.length > 0) {
      xml += `  <resultados_tools>\n`;
      xml += `    <descripcion>Resultados recientes de herramientas ejecutadas</descripcion>\n\n`;
      context.toolResults.forEach((tr, idx) => {
        xml += `    <tool_result indice="${idx + 1}">\n`;
        xml += `      <tool_name>${tr.toolName}</tool_name>\n`;
        xml += `      <resultado>\n${JSON.stringify(tr.result, null, 2)}\n</resultado>\n`;
        xml += `    </tool_result>\n\n`;
      });
      xml += `  </resultados_tools>\n\n`;
    }

    // =============================
    // EVALUATION INSTRUCTIONS
    // =============================
    xml += `  <instrucciones_evaluacion>\n`;
    xml += `    <instruccion>Para CADA guideline, evalúa si su CONDICIÓN se cumple en el contexto actual</instruccion>\n`;
    xml += `    <instruccion>Considera el historial reciente, el último mensaje del usuario, y los resultados de tools si existen</instruccion>\n`;
    xml += `    <instruccion>Asigna un nivel de confianza (0.0 a 1.0) sobre qué tan bien la condición coincide con el contexto</instruccion>\n`;
    xml += `    <instruccion>Proporciona razonamiento claro y específico para cada evaluación</instruccion>\n`;
    xml += `    <instruccion>Si una guideline NO aplica, marca applies=false y confidence puede ser bajo</instruccion>\n`;
    xml += `    <instruccion>Evalúa TODAS las guidelines en el orden dado (1 a ${batch.length})</instruccion>\n`;
    xml += `  </instrucciones_evaluacion>\n\n`;

    // =============================
    // OUTPUT FORMAT
    // =============================
    xml += `  <formato_salida>\n`;
    xml += `    <instruccion>Devuelve un array de evaluaciones, una por cada guideline en el mismo orden</instruccion>\n`;
    xml += `    <estructura_esperada>\n`;
    xml += `      <campo nombre="guidelineIndex">Índice de la guideline (1-based, del 1 al ${batch.length})</campo>\n`;
    xml += `      <campo nombre="applies">Boolean - ¿La condición se cumple?</campo>\n`;
    xml += `      <campo nombre="confidence">Number (0-1) - Confianza en la evaluación</campo>\n`;
    xml += `      <campo nombre="reasoning">String - Explicación concisa del por qué</campo>\n`;
    xml += `    </estructura_esperada>\n`;
    xml += `  </formato_salida>\n\n`;

    xml += `</evaluation_prompt>`;

    return xml;
  }

  // Evaluate a batch of guidelines in a single LLM call
  private async evaluateBatch(
    batch: Guideline[],
    conversationSummary: string,
    context: ConversationContext,
    batchIndex: number
  ): Promise<GuidelineMatch[]> {
    try {
      console.log(`[GuidelineMatcher] Evaluating batch ${batchIndex + 1} with ${batch.length} guidelines`);

      // Build evaluation prompt in XML format
      const evaluationPrompt = this.buildEvaluationPrompt(batch, conversationSummary, context);

      console.log("🤖 conversationSummary", conversationSummary);

      const { object } = await generateObject({
        model: this.model,
        schema: z.object({
          evaluations: z.array(z.object({
            guidelineIndex: z.number().describe('Índice de la guideline (1-based)'),
            applies: z.boolean().describe('¿La condición de la guideline se cumple?'),
            confidence: z.number().min(0).max(1).describe('Confianza en la evaluación (0-1)'),
            reasoning: z.string().describe('Explicación concisa de por qué aplica o no')
          }))
        }),
        prompt: evaluationPrompt
      });

      // Map results back to GuidelineMatch objects
      const matches: GuidelineMatch[] = object.evaluations.map(evaluation => {
        const guideline = batch[evaluation.guidelineIndex - 1];
        if (!guideline) {
          console.warn(`[GuidelineMatcher] Invalid guideline index ${evaluation.guidelineIndex} in batch ${batchIndex + 1}`);
          return null;
        }
        return {
          guideline,
          score: evaluation.applies ? evaluation.confidence : 0,
          reason: evaluation.reasoning
        };
      }).filter((m): m is GuidelineMatch => m !== null);

      return matches;

    } catch (error) {
      console.warn(`[GuidelineMatcher] Batch evaluation failed for batch ${batchIndex + 1}, falling back to individual evaluation:`, error instanceof Error ? error.message : error);
      
      // Fallback: evaluate individually if batch fails
      const evaluationPromises = batch.map(guideline =>
        this.evaluateGuideline(guideline, conversationSummary, context)
      );
      return await Promise.all(evaluationPromises);
    }
  }

  // Build single guideline evaluation prompt in XML format
  private buildSingleGuidelinePrompt(
    guideline: Guideline,
    conversationSummary: string,
    context: ConversationContext
  ): string {
    let xml = `<guideline_evaluation>\n\n`;

    // ROLE
    xml += `  <role>\n`;
    xml += `    <descripcion>Evaluador semántico de guideline individual</descripcion>\n`;
    xml += `    <objetivo>Determinar si esta guideline específica aplica al contexto actual</objetivo>\n`;
    xml += `  </role>\n\n`;

    // GUIDELINE
    xml += `  <guideline>\n`;
    xml += `    <id>${guideline.id}</id>\n`;
    xml += `    <condicion>${guideline.condition}</condicion>\n`;
    xml += `    <accion>${guideline.action}</accion>\n`;
    xml += `    <prioridad>${guideline.priority}</prioridad>\n`;
    xml += `  </guideline>\n\n`;

    // CONTEXT
    xml += `  <contexto_conversacional>\n`;
    xml += `    <historial_reciente>\n${conversationSummary}\n</historial_reciente>\n`;
    xml += `  </contexto_conversacional>\n\n`;

    const lastMessage = context.messages[context.messages.length - 1]?.content || 'N/A';
    xml += `  <ultimo_mensaje>\n`;
    xml += `    <contenido>${lastMessage}</contenido>\n`;
    xml += `  </ultimo_mensaje>\n\n`;

    // TOOL RESULTS
    if (context.toolResults && context.toolResults.length > 0) {
      xml += `  <resultados_tools>\n`;
      context.toolResults.forEach((tr, idx) => {
        xml += `    <tool_result indice="${idx + 1}">\n`;
        xml += `      <tool_name>${tr.toolName}</tool_name>\n`;
        xml += `      <resultado>\n${JSON.stringify(tr.result, null, 2)}\n</resultado>\n`;
        xml += `    </tool_result>\n`;
      });
      xml += `  </resultados_tools>\n\n`;
    }

    // INSTRUCTIONS
    xml += `  <instrucciones>\n`;
    xml += `    <instruccion>Evalúa cuidadosamente si la CONDICIÓN de la guideline se cumple en este contexto específico</instruccion>\n`;
    xml += `    <instruccion>Considera el historial reciente, el último mensaje y los resultados de tools</instruccion>\n`;
    xml += `    <instruccion>Asigna confianza alta (0.8-1.0) si coincide claramente, media (0.5-0.8) si parcialmente, baja (0-0.5) si no coincide</instruccion>\n`;
    xml += `  </instrucciones>\n\n`;

    xml += `</guideline_evaluation>`;

    return xml;
  }

  // Evaluate a specific guideline
  private async evaluateGuideline(
    guideline: Guideline,
    conversationSummary: string,
    context: ConversationContext
  ): Promise<GuidelineMatch> {
    try {
      // Build prompt in XML format
      const evaluationPrompt = this.buildSingleGuidelinePrompt(guideline, conversationSummary, context);

      // Try with generateObject first (works best with capable models)
      const { object } = await generateObject({
        model: this.model,
        schema: z.object({
          applies: z.boolean().describe('¿La condición de la guideline se cumple?'),
          confidence: z.number().min(0).max(1).describe('Confianza en la evaluación'),
          reasoning: z.string().describe('Explicación de por qué aplica o no')
        }),
        prompt: evaluationPrompt
      });

      console.log("🤖 evaluateGuideline object", object);

      return {
        guideline,
        score: object.applies ? object.confidence : 0,
        reason: object.reasoning
      };
    } catch (error) {
      console.warn(`[GuidelineMatcher] generateObject failed for ${guideline.id}, trying text fallback:`, error instanceof Error ? error.message : error);
      
      // Fallback: Use generateText and parse JSON manually
      return await this.evaluateGuidelineWithTextFallback(guideline, conversationSummary, context);
    }
  }

  // Fallback method using generateText for models that struggle with structured output
  private async evaluateGuidelineWithTextFallback(
    guideline: Guideline,
    conversationSummary: string,
    context: ConversationContext
  ): Promise<GuidelineMatch> {
    try {
      // Build XML prompt
      const evaluationPrompt = this.buildSingleGuidelinePrompt(guideline, conversationSummary, context);

      // Add JSON output instructions
      const promptWithJson = `${evaluationPrompt}

<formato_salida>
  <instruccion>Responde SOLO con un objeto JSON válido en este formato exacto</instruccion>
  <estructura>
{
  "applies": true o false,
  "confidence": número entre 0 y 1,
  "reasoning": "tu explicación aquí"
}
</estructura>
  <nota>NO incluyas texto adicional, SOLO el JSON</nota>
</formato_salida>`;

      const { text } = await generateText({
        model: this.model,
        prompt: promptWithJson
      });

      // Extract JSON from response (handling markdown code blocks)
      let jsonText = text.trim();
      
      // Remove markdown code blocks if present
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
      }
      
      // Try to parse the JSON
      const parsed = JSON.parse(jsonText);
      
      // Validate the structure
      const applies = Boolean(parsed.applies);
      const confidence = typeof parsed.confidence === 'number' 
        ? Math.max(0, Math.min(1, parsed.confidence)) 
        : 0.5;
      const reasoning = String(parsed.reasoning || 'No reasoning provided');

      return {
        guideline,
        score: applies ? confidence : 0,
        reason: reasoning
      };
    } catch (fallbackError) {
      console.error(`[GuidelineMatcher] Text fallback also failed for ${guideline.id}:`, fallbackError instanceof Error ? fallbackError.message : fallbackError);
      
      // Last resort: return low score
      return { 
        guideline, 
        score: 0, 
        reason: 'Evaluation failed - model unable to generate valid response' 
      };
    }
  }

  // Quick filtering based on rules (optional, for pre-filtering)
  quickFilterByRules(context: ConversationContext): Guideline[] {
    const lastMessage = context.messages[context.messages.length - 1]?.content || '';
    
    return this.guidelines.filter(guideline => {
      // Simple filters based on keywords
      const conditionLower = guideline.condition.toLowerCase();
      const messageLower = lastMessage.toLowerCase();

      // Example: if the condition mentions "payment" and the message also does
      const keywords = conditionLower.split(' ')
        .filter(word => word.length > 4); // Only significant words

      return keywords.some(keyword => messageLower.includes(keyword));
    });
  }

  // Hybrid matching: pre-filtering + semantic evaluation
  async hybridMatch(
    context: ConversationContext,
    threshold: number = 0.7,
    batchSize: number = 5
  ): Promise<GuidelineMatch[]> {
    // Step 1: Fast pre-filtering
    const candidates = this.quickFilterByRules(context);
    
    if (candidates.length === 0) return [];

    // Step 2: Semantic evaluation only of candidates (with batching)
    const tempMatcher = new GuidelineMatcher(candidates);
    return await tempMatcher.matchGuidelines(context, threshold, batchSize);
  }

  // Re-evaluation after tool execution
  async reevaluateAfterTools(
    context: ConversationContext,
    toolResults: Array<{ toolName: string; result: any }>
  ): Promise<GuidelineMatch[]> {
    console.log('[GuidelineMatcher] Re-evaluating guidelines after tool execution...');
    
    // Add results to context
    const enrichedContext: ConversationContext = {
      ...context,
      toolResults
    };

    // Re-evaluate with new context
    return await this.matchGuidelines(enrichedContext);
  }

  // Utilities
  private summarizeConversation(context: ConversationContext): string {
    const recent = context.messages.slice(-5); // Last 5 messages
    return recent
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');
  }

  private getCacheKey(context: ConversationContext): string {
    const lastMessage = context.messages[context.messages.length - 1]?.content || '';
    return `${context.sessionId}-${lastMessage.slice(0, 50)}`;
  }
}

