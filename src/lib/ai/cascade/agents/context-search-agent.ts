/**
 * ContextSearchAgent - Handles searching in conversation history and context
 * 
 * This agent processes 'context_search' type tasks that search through
 * conversation history, context variables, and previous interactions
 * to find relevant information.
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { PlanTask, ActionPlan } from '../types';
import type { GuidelineMatch } from '../../types/guideline';
import type { LLMMessage } from '../../context/conversation-loader';
import { AI_CONFIG } from '../../config';
import { getModel } from '../../openrouter';

export interface ContextSearchInput {
  task: PlanTask;
  userMessage: string;
  messages: LLMMessage[];
  activeGuidelines: GuidelineMatch[];
  previousTaskResults: Map<string, string>;
  planContext?: ActionPlan;
}

export interface ContextSearchOutput {
  taskId: string;
  success: boolean;
  searchQuery: string;      // What was being searched for
  foundItems: FoundItem[];  // Items found in context
  summary: string;          // Summary of findings
  rawMatches: string[];     // Raw text matches
  confidence: number;       // Confidence level 0-1
  error?: string;
}

export interface FoundItem {
  type: 'message' | 'property' | 'visit' | 'variable' | 'other';
  source: string;           // Where it was found
  content: string;          // The content
  relevance: number;        // Relevance score 0-1
  metadata?: Record<string, any>;
}

export class ContextSearchAgent {
  private model;

  constructor() {
    this.model = getModel(AI_CONFIG?.CASCADE?.CONTEXT_SEARCH_MODEL || 'gpt-4o-mini');
  }

  /**
   * Execute context search task
   */
  async execute(input: ContextSearchInput): Promise<ContextSearchOutput> {
    console.log(`[ContextSearchAgent] Processing task: ${input.task.id}`);
    console.log(`[ContextSearchAgent] Description: ${input.task.description}`);

    try {
      // // First, do a direct search in conversation context
      // const directMatches = this.searchDirectly(input);
      
      // Then use LLM to analyze and find more context
      const llmAnalysis = await this.searchWithLLM(input);

      // const allItems = [...directMatches, ...llmAnalysis.additionalItems];
      
      console.log(`[ContextSearchAgent] Task ${input.task.id} completed`);
      console.log(`[ContextSearchAgent] Found ${llmAnalysis.additionalItems.length} items`);

      return {
        taskId: input.task.id,
        success: true,
        searchQuery: input.task.description,
        foundItems: llmAnalysis.additionalItems,
        summary: llmAnalysis.summary,
        rawMatches: llmAnalysis.additionalItems.map(i => i.content),
        confidence: llmAnalysis.confidence
      };

    } catch (error) {
      console.error(`[ContextSearchAgent] Error in task ${input.task.id}:`, error);
      return {
        taskId: input.task.id,
        success: false,
        searchQuery: input.task.description,
        foundItems: [],
        summary: '',
        rawMatches: [],
        confidence: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Direct search in conversation context without LLM
   */
  private searchDirectly(input: ContextSearchInput): FoundItem[] {
    const items: FoundItem[] = [];
    const searchTerms = this.extractSearchTerms(input.task.description);

    // Search in recent messages
    if (input.messages) {
      input.messages.forEach((msg, index) => {
        const content = msg.content.toLowerCase();
        const matches = searchTerms.filter(term => content.includes(term.toLowerCase()));
        
        if (matches.length > 0) {
          items.push({
            type: 'message',
            source: `message_${index}_${msg.role}`,
            content: msg.content,
            relevance: matches.length / searchTerms.length,
            metadata: {
              role: msg.role,
              messageIndex: index,
              matchedTerms: matches
            }
          });
        }
      });
    }

    // // Search in context variables (from metadata)
    // if (input.planContext?.metadata) {
    //   const vars = input.planContext.metadata as Record<string, any>;
      
    //   // Check for visit-related variables
    //   if (vars.lastVisitId || vars.pendingVisitId || vars.visitPropertyId) {
    //     items.push({
    //       type: 'visit',
    //       source: 'context_variables',
    //       content: JSON.stringify({
    //         lastVisitId: vars.lastVisitId,
    //         pendingVisitId: vars.pendingVisitId,
    //         visitPropertyId: vars.visitPropertyId,
    //         visitDate: vars.visitDate
    //       }),
    //       relevance: 0.8,
    //       metadata: vars
    //     });
    //   }

    //   // Check for property-related variables
    //   if (vars.lastPropertyId || vars.lastSearchResults || vars.interestedPropertyIds) {
    //     items.push({
    //       type: 'property',
    //       source: 'context_variables',
    //       content: JSON.stringify({
    //         lastPropertyId: vars.lastPropertyId,
    //         lastSearchResults: vars.lastSearchResults,
    //         interestedPropertyIds: vars.interestedPropertyIds
    //       }),
    //       relevance: 0.8,
    //       metadata: vars
    //     });
    //   }

    //   // Generic variable search
    //   Object.entries(vars).forEach(([key, value]) => {
    //     if (value !== undefined && value !== null) {
    //       const valueStr = String(value).toLowerCase();
    //       const keyLower = key.toLowerCase();
          
    //       searchTerms.forEach(term => {
    //         if (keyLower.includes(term.toLowerCase()) || valueStr.includes(term.toLowerCase())) {
    //           items.push({
    //             type: 'variable',
    //             source: `variable_${key}`,
    //             content: `${key}: ${JSON.stringify(value)}`,
    //             relevance: 0.6,
    //             metadata: { key, value }
    //           });
    //         }
    //       });
    //     }
    //   });
    // }

    // Search in previous task results
    input.previousTaskResults.forEach((result, taskId) => {
      const resultLower = result.toLowerCase();
      const matches = searchTerms.filter(term => resultLower.includes(term.toLowerCase()));
      
      if (matches.length > 0) {
        items.push({
          type: 'other',
          source: `previous_task_${taskId}`,
          content: result,
          relevance: matches.length / searchTerms.length,
          metadata: { taskId, matchedTerms: matches }
        });
      }
    });

    // Remove duplicates and sort by relevance
    const uniqueItems = this.deduplicateItems(items);
    return uniqueItems.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Extract search terms from task description
   */
  private extractSearchTerms(description: string): string[] {
    // Remove common words and extract meaningful terms
    const stopWords = ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'a', 'al', 'y', 'o', 'que', 'para', 'con', 'por', 'se', 'su', 'es', 'buscar', 'encontrar', 'historial', 'conversacion', 'contexto'];
    
    const words = description.toLowerCase()
      .replace(/[^\w\sáéíóúñ]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));

    // Also look for IDs (numbers) and specific patterns
    const idMatches = description.match(/\b\d+\b/g) || [];
    
    return [...new Set([...words, ...idMatches])];
  }

  /**
   * Remove duplicate items
   */
  private deduplicateItems(items: FoundItem[]): FoundItem[] {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = `${item.type}_${item.source}_${item.content.substring(0, 50)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Use LLM to analyze context and find more information
   */
  private async searchWithLLM(
    input: ContextSearchInput, 
  ): Promise<{ summary: string; additionalItems: FoundItem[]; confidence: number }> {
    
    const prompt = this.buildLLMPrompt(input);

    const result = await generateText({
      model: this.model,
      system: prompt,
      prompt: 'Analiza el contexto y encuentra la información solicitada.',
      temperature: 0.2
    });

    return this.parseLLMResponse(result.text);
  }

  /**
   * Build prompt for LLM analysis
   */
  private buildLLMPrompt(input: ContextSearchInput): string {
    let prompt = `<context_search_agent>\n\n`;

    prompt += `  <role>\n`;
    prompt += `    <descripcion>Eres un agente especializado en buscar información en el contexto de conversación</descripcion>\n`;
    prompt += `    <objetivo>Encontrar información específica en el historial y contexto</objetivo>\n`;
    prompt += `  </role>\n\n`;

    prompt += `  <tarea_busqueda>\n`;
    prompt += `    <id>${input.task.id}</id>\n`;
    prompt += `    <descripcion>${input.task.description}</descripcion>\n`;
    prompt += `  </tarea_busqueda>\n\n`;

    prompt += `  <mensaje_usuario_actual>\n`;
    prompt += `    ${input.userMessage}\n`;
    prompt += `  </mensaje_usuario_actual>\n\n`;

    // Full conversation history
    if (input.messages && input.messages.length > 0) {
      prompt += `  <historial_completo>\n`;
      input.messages.forEach((msg, i) => {
        prompt += `    <mensaje index="${i}" rol="${msg.role}">\n`;
        prompt += `      ${msg.content}\n`;
        prompt += `    </mensaje>\n`;
      });
      prompt += `  </historial_completo>\n\n`;
    }

    // // Context variables (from metadata)
    // if (input.planContext?.metadata) {
    //   prompt += `  <variables_contexto>\n`;
    //   prompt += `    ${JSON.stringify(input.conversationContext.metadata, null, 2)}\n`;
    //   prompt += `  </variables_contexto>\n\n`;
    // }
    // Previous task results
    if (input.previousTaskResults.size > 0) {
      prompt += `  <resultados_tareas_previas>\n`;
      input.previousTaskResults.forEach((result, taskId) => {
        prompt += `    <resultado task_id="${taskId}">${result}</resultado>\n`;
      });
      prompt += `  </resultados_tareas_previas>\n\n`;
    }

    prompt += `  <instrucciones>\n`;
    prompt += `    <instruccion>Analiza TODO el contexto disponible para encontrar la información solicitada</instruccion>\n`;
    prompt += `    <instruccion>Busca especialmente: IDs de propiedades, IDs de visitas, fechas, nombres</instruccion>\n`;
    prompt += `    <instruccion>Si encuentras referencias indirectas, conéctalas</instruccion>\n`;
    prompt += `    <instruccion>Responde en formato estructurado</instruccion>\n`;
    prompt += `  </instrucciones>\n\n`;

    prompt += `  <formato_respuesta>\n`;
    prompt += `    RESUMEN:\n`;
    prompt += `    [Resumen de lo encontrado]\n\n`;
    prompt += `    ITEMS_ENCONTRADOS:\n`;
    prompt += `    - tipo: [message|property|visit|variable|other]\n`;
    prompt += `      contenido: [contenido encontrado]\n`;
    prompt += `      relevancia: [0.0-1.0]\n\n`;
    prompt += `    CONFIANZA: 0.X\n`;
    prompt += `  </formato_respuesta>\n\n`;

    prompt += `</context_search_agent>`;

    return prompt;
  }

  /**
   * Parse LLM response
   */
  private parseLLMResponse(text: string): { 
    summary: string; 
    additionalItems: FoundItem[]; 
    confidence: number 
  } {
    let summary = '';
    const additionalItems: FoundItem[] = [];
    let confidence = 0.5;

    // Extract RESUMEN
    const summaryMatch = text.match(/RESUMEN:\s*([\s\S]*?)(?=ITEMS_ENCONTRADOS:|CONFIANZA:|$)/i);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    // Extract ITEMS_ENCONTRADOS
    const itemsMatch = text.match(/ITEMS_ENCONTRADOS:\s*([\s\S]*?)(?=CONFIANZA:|$)/i);
    if (itemsMatch) {
      const itemsText = itemsMatch[1];
      
      // Parse each item block
      const itemBlocks = itemsText.split(/(?=- tipo:)/);
      itemBlocks.forEach(block => {
        if (!block.trim()) return;
        
        const tipoMatch = block.match(/tipo:\s*(\w+)/i);
        const contenidoMatch = block.match(/contenido:\s*([\s\S]+?)(?=relevancia:|$)/i);
        const relevanciaMatch = block.match(/relevancia:\s*([\d.]+)/i);

        if (tipoMatch && contenidoMatch) {
          const tipo = tipoMatch[1].toLowerCase() as FoundItem['type'];
          additionalItems.push({
            type: ['message', 'property', 'visit', 'variable', 'other'].includes(tipo) 
              ? tipo as FoundItem['type'] 
              : 'other',
            source: 'llm_analysis',
            content: contenidoMatch[1].trim(),
            relevance: relevanciaMatch ? parseFloat(relevanciaMatch[1]) : 0.5
          });
        }
      });
    }

    // Extract CONFIANZA
    const confidenceMatch = text.match(/CONFIANZA:\s*([\d.]+)/i);
    if (confidenceMatch) {
      confidence = parseFloat(confidenceMatch[1]);
      if (isNaN(confidence) || confidence < 0 || confidence > 1) {
        confidence = 0.5;
      }
    }

    // Fallback
    if (!summary) {
      summary = text.substring(0, 500);
    }

    return { summary, additionalItems, confidence };
  }
}

