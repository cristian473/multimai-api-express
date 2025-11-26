import { BaseMicroAgent } from './base-micro-agent';
import { generateText } from 'ai';
import { getModel } from '../openrouter';
import { AI_CONFIG } from '../config';
import { retrievalRAG } from '@/lib/db/repositories/rag';
import type {
  MicroAgentConfig,
  MicroAgentExecutionContext,
  MicroAgentEvaluationResult,
  MicroAgentIterationState,
  MicroAgentResult
} from '../types/micro-agent-types';
import type { UserDocument } from '@/lib/db/repositories/user-documents';

/**
 * Context Search Result structure
 */
export interface ContextSearchResult {
  contextSummary: string;
  relevantDocuments: string[];
  augmentedQuery: string;
  rawResults: Array<{
    documentLabel: string;
    propositions: string[];
    similarity?: number;
  }>;
}

/**
 * Context Search Agent
 * 
 * Responsibilities:
 * 1. Receive available documents from guideline metadata
 * 2. Perform query augmentation based on relevant document labels
 * 3. Search RAG with appropriate keys [uid, 'agent-context', documentId]
 * 4. Generate a concise context summary for CoT and Composer
 */
export class ContextSearchAgent extends BaseMicroAgent {
  private uid: string;
  private availableDocuments: UserDocument[];

  constructor(uid: string, availableDocuments: UserDocument[]) {
    const config: MicroAgentConfig = {
      id: 'context_search',
      name: 'Context Search Agent',
      description: 'Busca información relevante en los documentos de contexto cargados por el usuario',
      associatedGuidelineIds: ['context_search'],
      toolNames: ['search_context'],
      maxIterations: 1, // Usually one search is enough
      evaluationThreshold: 6.0,
      enabled: true
    };

    super(config);
    this.uid = uid;
    this.availableDocuments = availableDocuments;
  }

  shouldActivate(context: MicroAgentExecutionContext): boolean {
    // Activate if context_search guideline is active and we have documents
    const hasContextSearchGuideline = context.activeGuidelines.some(
      g => g.guideline.id === 'context_search'
    );
    const hasDocuments = this.availableDocuments.length > 0;
    
    console.log(`[ContextSearchAgent] Should activate: guideline=${hasContextSearchGuideline}, docs=${hasDocuments}`);
    return hasContextSearchGuideline && hasDocuments;
  }

  /**
   * Execute context search
   */
  async executeContextSearch(
    userMessage: string,
    conversationContext?: string
  ): Promise<ContextSearchResult> {
    console.log('[ContextSearchAgent] Starting context search...');
    console.log(`[ContextSearchAgent] Available documents: ${this.availableDocuments.map(d => d.label).join(', ')}`);

    // Step 1: Query augmentation
    const augmentedQuery = await this.augmentQuery(userMessage, conversationContext);
    console.log(`[ContextSearchAgent] Augmented query: ${augmentedQuery}`);

    // Step 2: Get RAG keys from documents
    const ragKeys = this.getRAGKeys();
    console.log(`[ContextSearchAgent] RAG keys: ${ragKeys.join(', ')}`);

    // Step 3: Search RAG
    const ragResults = await retrievalRAG(ragKeys, augmentedQuery, 5);
    console.log(`[ContextSearchAgent] Found ${ragResults.length} RAG results`);

    // Step 4: Process results
    const processedResults = ragResults.map(result => ({
      documentLabel: result.metadata?.label || 'Unknown',
      propositions: result.propositions || [],
      similarity: result.similarity,
    }));

    // Step 5: Generate context summary
    const contextSummary = await this.generateContextSummary(
      userMessage,
      processedResults
    );

    return {
      contextSummary,
      relevantDocuments: processedResults.map(r => r.documentLabel),
      augmentedQuery,
      rawResults: processedResults,
    };
  }

  /**
   * Augment the user query for better RAG retrieval
   */
  private async augmentQuery(
    userMessage: string,
    conversationContext?: string
  ): Promise<string> {
    try {
      const documentLabels = this.availableDocuments.map(d => d.label).join(', ');

      const prompt = `Eres un experto en expansión de queries para búsqueda semántica.

DOCUMENTOS DISPONIBLES:
${documentLabels}

MENSAJE DEL USUARIO:
${userMessage}

${conversationContext ? `CONTEXTO DE LA CONVERSACIÓN:\n${conversationContext}` : ''}

TAREA:
Expande la consulta del usuario para mejorar la búsqueda en los documentos disponibles.
- Agrega sinónimos relevantes
- Incluye términos relacionados con los documentos disponibles
- Mantén el idioma español
- Sé conciso (máximo 2-3 oraciones)

Devuelve SOLO la query expandida, nada más.`;

      const { text: augmented } = await generateText({
        model: getModel(AI_CONFIG.CONTEXT_SEARCH_MODEL),
        prompt,
        temperature: 0.3,
      });

      return augmented.trim() || userMessage;
    } catch (error) {
      console.error('[ContextSearchAgent] Error augmenting query:', error);
      return userMessage;
    }
  }

  /**
   * Get RAG keys from available documents
   */
  private getRAGKeys(): string[] {
    const keys = new Set<string>();
    keys.add(this.uid);
    keys.add('agent-context');

    this.availableDocuments.forEach(doc => {
      keys.add(doc.id);
      if (doc.ragKeys) {
        doc.ragKeys.forEach(key => keys.add(key));
      }
    });

    return Array.from(keys);
  }

  /**
   * Generate a concise context summary from RAG results
   */
  private async generateContextSummary(
    userMessage: string,
    results: Array<{ documentLabel: string; propositions: string[]; similarity?: number }>
  ): Promise<string> {
    if (results.length === 0) {
      return 'No se encontró información relevante en los documentos de contexto.';
    }

    try {
      // Flatten all propositions with their source
      const allPropositions = results.flatMap(r => 
        r.propositions.map(p => `[${r.documentLabel}] ${p}`)
      );

      if (allPropositions.length === 0) {
        return 'No se encontraron proposiciones relevantes en los documentos.';
      }

      const prompt = `Eres un asistente que genera resúmenes concisos de información.

PREGUNTA DEL USUARIO:
${userMessage}

INFORMACIÓN ENCONTRADA EN DOCUMENTOS:
${allPropositions.slice(0, 20).join('\n')}

TAREA:
Genera un resumen conciso (2-4 oraciones) de la información relevante para responder la pregunta del usuario.
- Solo incluye información que esté en los documentos
- Menciona la fuente cuando sea relevante
- No inventes información

Devuelve SOLO el resumen, nada más.`;

      const { text: summary } = await generateText({
        model: getModel(AI_CONFIG.CONTEXT_SEARCH_MODEL),
        prompt,
        temperature: 0.3,
      });

      return summary.trim();
    } catch (error) {
      console.error('[ContextSearchAgent] Error generating summary:', error);
      // Fallback: return raw propositions
      const topPropositions = results
        .flatMap(r => r.propositions)
        .slice(0, 5)
        .join('. ');
      return topPropositions || 'Error al generar resumen del contexto.';
    }
  }

  /**
   * Implementation of executeIteration for BaseMicroAgent
   */
  protected async executeIteration(
    context: MicroAgentExecutionContext,
    previousState?: MicroAgentIterationState
  ): Promise<{ response: string; toolsExecuted: string[] }> {
    const conversationSummary = context.conversationContext.messages
      .slice(-5)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const result = await this.executeContextSearch(
      context.userMessage,
      conversationSummary
    );

    // Format response as XML for consistency
    const response = `<context_search_result>
  <summary>${result.contextSummary}</summary>
  <documents_searched>${result.relevantDocuments.join(', ')}</documents_searched>
  <augmented_query>${result.augmentedQuery}</augmented_query>
</context_search_result>`;

    return {
      response,
      toolsExecuted: ['search_context']
    };
  }

  /**
   * Implementation of evaluate for BaseMicroAgent
   */
  protected async evaluate(
    response: string,
    context: MicroAgentExecutionContext,
    toolsExecuted: string[]
  ): Promise<MicroAgentEvaluationResult> {
    // Simple evaluation: check if we got useful context
    const hasSummary = response.includes('<summary>') && !response.includes('No se encontró');
    const hasDocuments = response.includes('<documents_searched>');
    
    const score = (hasSummary ? 7 : 3) + (hasDocuments ? 3 : 0);

    return {
      score,
      isValid: score >= 6,
      feedback: hasSummary 
        ? 'Context search completed successfully' 
        : 'No relevant context found in documents',
      issues: hasSummary ? [] : ['No relevant information found'],
      suggestions: [],
      shouldRetry: false // Don't retry context search
    };
  }

  /**
   * Get the context result directly (convenience method)
   */
  async getContextResult(
    userMessage: string,
    conversationContext?: string
  ): Promise<ContextSearchResult> {
    return this.executeContextSearch(userMessage, conversationContext);
  }
}

/**
 * Factory function to create ContextSearchAgent from guideline metadata
 */
export function createContextSearchAgent(
  uid: string,
  guidelineMetadata?: { availableDocuments?: UserDocument[] }
): ContextSearchAgent | null {
  const documents = guidelineMetadata?.availableDocuments || [];
  
  if (documents.length === 0) {
    console.log('[ContextSearchAgent] No documents available, agent not created');
    return null;
  }

  return new ContextSearchAgent(uid, documents);
}


