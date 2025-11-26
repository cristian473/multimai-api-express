import { BaseMicroAgent } from './base-micro-agent';
import type {
  MicroAgentConfig,
  MicroAgentExecutionContext,
  MicroAgentEvaluationResult,
  MicroAgentIterationState,
  MicroAgentResult
} from '../types/micro-agent-types';
import type { GuidelineMatch } from '../types/guideline';
import type { Guideline } from '../types/guideline';
import type { GuidelineAgent } from '../guideline-agent';
import { generateText } from 'ai';
import { getModel } from '../openrouter';
import { AI_CONFIG } from '../config';
import type { ContextSearchResult } from './context-search-agent';

/**
 * Chain of Thought Reasoning Agent
 * Generates structured reasoning before the main composer
 */
export class ChainOfThoughtAgent extends BaseMicroAgent {
  private contextSummary: string | null;
  private availableTools: string[];
  private microAgentsResults: MicroAgentResult[];
  private guidelines: GuidelineMatch[];
  private glossaryContext: string;
  private executionContextSummary: string | null;
  private ragContext: ContextSearchResult | null;

  constructor(
    allGuidelines: Guideline[],
    guidelineAgent: GuidelineAgent,
    contextSummary: string | null,
    availableTools: string[],
    microAgentsResults: MicroAgentResult[] = [],
    guidelines: GuidelineMatch[] = [],
    glossaryContext: string = '',
    executionContextSummary: string | null = null,
    ragContext: ContextSearchResult | null = null
  ) {
    const config: MicroAgentConfig = {
      id: 'chain_of_thought',
      name: 'Chain of Thought Reasoning Agent',
      description: 'Genera una cadena de pensamientos estructurada antes de componer la respuesta final',
      associatedGuidelineIds: [], // Se activa siempre
      toolNames: [],
      maxIterations: 1,
      evaluationThreshold: 7.0,
      enabled: true
    };

    super(config);
    this.contextSummary = contextSummary;
    this.availableTools = availableTools;
    this.microAgentsResults = microAgentsResults;
    this.guidelines = guidelines;
    this.glossaryContext = glossaryContext;
    this.executionContextSummary = executionContextSummary;
    this.ragContext = ragContext;
  }

  shouldActivate(context: MicroAgentExecutionContext): boolean {
    // Este agente siempre se activa (es el razonador principal)
    return true;
  }

  protected async executeIteration(
    context: MicroAgentExecutionContext,
    previousState?: MicroAgentIterationState
  ): Promise<{ response: string; toolsExecuted: string[] }> {
    console.log(`[${this.config.id}] Generating chain of thought reasoning...`);

    // Build reasoning prompt
    const reasoningPrompt = this.buildReasoningPrompt(context);

    // Execute reasoning with LLM
    const model = getModel(AI_CONFIG?.COMPOSER_MODEL_HIGH ?? 'gpt-4o-mini');

    const result = await generateText({
      model: model as any,
      system: reasoningPrompt,
      prompt: 'Generate the chain of thought reasoning for this conversation.',
      temperature: 0.7,
      maxOutputTokens: 2000
    });

    const responseText = result.text;
    console.log(`[${this.config.id}] Generated reasoning (${responseText.length} chars)`);

    return {
      response: responseText,
      toolsExecuted: []
    };
  }

  protected async evaluate(
    response: string,
    context: MicroAgentExecutionContext,
    toolsExecuted: string[]
  ): Promise<MicroAgentEvaluationResult> {
    // Simple validation: check if response has thinking tags
    const hasThinking = response.includes('<thinking>');
    const hasSteps = response.includes('<step>');
    const hasReflections = response.includes('<reflection>');

    const score = (hasThinking ? 4 : 0) + (hasSteps ? 3 : 0) + (hasReflections ? 3 : 0);

    return {
      score: score,
      isValid: score >= 7,
      feedback: score >= 7 ? 'Reasoning structure is complete' : 'Missing structured reasoning elements',
      issues: [
        ...(!hasThinking ? ['Missing <thinking> tags'] : []),
        ...(!hasSteps ? ['Missing <step> tags'] : []),
        ...(!hasReflections ? ['Missing <reflection> tags'] : [])
      ],
      suggestions: score >= 7 ? [] : ['Add structured reasoning with thinking, steps, and reflections'],
      shouldRetry: score < 7
    };
  }

  private buildReasoningPrompt(context: MicroAgentExecutionContext): string {
    // Historial reciente (últimos 10 mensajes)
    const conversationHistory = context.conversationContext.messages
      .slice(-50)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    // Guidelines con prioridad
    const guidelinesToUse = this.guidelines.length > 0
      ? this.guidelines
      : context.activeGuidelines;

    const guidelinesFormatted = guidelinesToUse
      .map(g => {
        const validation = g.guideline.validationCriteria?.length > 0
          ? ` [Validación: ${g.guideline.validationCriteria.map(c => c.name).join(', ')}]`
          : '';

        return `    <guideline id="${g.guideline.id}">
      <condicion>${g.guideline.condition}</condicion>
      <accion>${g.guideline.action}</accion>${validation}
    </guideline>`;
      })
      .join('\n');

    // Análisis de micro-agentes (si existen)
    // const microAgentsSection = this.buildMicroAgentsSection();

    // Contextos adicionales
    const additionalContexts = this.buildAdditionalContexts();

    return `<tarea>
Genera un plan de razonamiento estructurado para ayudar al agente ejecutor a responder al usuario.

<contexto>
  <conversacion_reciente>
${conversationHistory}
  </conversacion_reciente>

  <mensaje_actual>
${context.userMessage}
  </mensaje_actual>

  <guidelines_disponibles>
${guidelinesFormatted}
  </guidelines_disponibles>

  <herramientas_disponibles>
${this.availableTools.map(t => `    <tool>${t}</tool>`).join('\n')}
  </herramientas_disponibles>
${additionalContexts}
</contexto>

<instrucciones>
Analiza el mensaje del usuario y genera un plan de acción siguiendo este formato:

<thinking>
  <step>Identificar intención del usuario</step>
  <count>10</count>
  [Análisis breve y directo]
  
  <reflection>
  [Validación del análisis]
  <reward>0.0-1.0</reward>
  </reflection>

  <step>Determinar guidelines aplicables</step>
  <count>9</count>
  [Qué guidelines aplican y por qué]
  
  <step>Definir herramientas a ejecutar</step>
  <count>8</count>
  [Herramientas necesarias con parámetros]
  
  <step>Estructurar respuesta</step>
  <count>7</count>
  [Cómo presentar la información]

  <answer>
INTENCION: [qué busca el usuario]
GUIDELINES: [IDs separados por comas, ordenados por prioridad]
HERRAMIENTAS: [lista ordenada con parámetros si aplica]
INFORMACION_CLAVE: [datos esenciales a incluir]
ESTRUCTURA: [formato de respuesta recomendado]
TONO: [estilo comunicacional apropiado]
  </answer>

  <reflection>
  [Validación final del plan]
  <reward>0.0-1.0</reward>
  </reflection>
</thinking>

Reglas:
- Máximo 10 pasos (budget inicial)
- Usa <count> para trackear pasos restantes
- Reward > 0.7 indica buen progreso
- Reward < 0.5 requiere reconsiderar el enfoque
- Sé conciso: cada paso debe aportar valor
- Si hay micro-agents, considera sus análisis en tu razonamiento
</instrucciones>

<ejemplo_formato>
<thinking>
  <step>Identificar intención del usuario</step>
  <count>9</count>
  El usuario solicita ver más fotos de una propiedad específica. Interés alto.
  
  <reflection>
  Intención clara y directa.
  <reward>0.9</reward>
  </reflection>

  <step>Determinar guidelines aplicables</step>
  <count>8</count>
  - show_photos: solicitud explícita de imágenes
  - show_interest: nivel alto de interés en la propiedad
  
  <step>Definir herramientas a ejecutar</step>
  <count>7</count>
  get_property_info(property_id="Casa Residencia en Gral Pacheco")
  
  <step>Estructurar respuesta</step>
  <count>6</count>
  1. Enviar fotos en formato Markdown
  2. Ofrecer visita presencial (2-3 líneas)

  <answer>
INTENCION: Ver galería completa de fotos de la propiedad
GUIDELINES: show_photos, show_interest
HERRAMIENTAS: get_property_info
INFORMACION_CLAVE: Todas las fotos disponibles de la propiedad
ESTRUCTURA: Imágenes en Markdown + oferta de visita
TONO: Natural, conversacional argentino
  </answer>

  <reflection>
  Plan claro y ejecutable. Prioriza la solicitud del usuario.
  <reward>0.9</reward>
  </reflection>
</thinking>
</ejemplo_formato>
</tarea>`;
  }

  // Métodos auxiliares para mantener código limpio
  private buildMicroAgentsSection(): string {
    if (this.microAgentsResults?.length === 0) return '';

    const agentsAnalysis = this.microAgentsResults
      .map((result, idx) => {
        let agent = `
  <agente id="${result.agentId}" index="${idx + 1}">
    <exito>${result.success}</exito>
    <iteraciones>${result.metadata.iterations}</iteraciones>`;

        if (result.metadata.finalScore !== undefined) {
          agent += `
    <score_validacion>${result.metadata.finalScore}/10</score_validacion>`;
        }

        if (result.metadata.toolsExecuted.length > 0) {
          agent += `
    <herramientas_usadas>${result.metadata.toolsExecuted.join(', ')}</herramientas_usadas>`;
        }

        if (result.metadata.activatedGuidelines.length > 0) {
          agent += `
    <guidelines_activadas>${result.metadata.activatedGuidelines.join(', ')}</guidelines_activadas>`;
        }

        if (result.response?.trim()) {
          agent += `
    <analisis>${result.response.trim()}</analisis>`;
        }

        if (result.error) {
          agent += `
    <error>${result.error}</error>`;
        }

        agent += `
  </agente>`;
        return agent;
      })
      .join('\n');

    return `
  
  <analisis_micro_agentes>
    <descripcion>Análisis paralelo realizado por agentes especializados</descripcion>${agentsAnalysis}
  </analisis_micro_agentes>`;
  }

  private buildAdditionalContexts(): string {
    let contexts = '';

    if (this.contextSummary) {
      contexts += `

  <resumen_contexto>
${this.contextSummary}
  </resumen_contexto>`;
    }

    if (this.glossaryContext) {
      contexts += `

  <glosario>
${this.glossaryContext}
  </glosario>`;
    }

    if (this.executionContextSummary) {
      contexts += `

  <historial_ejecucion>
${this.executionContextSummary}
  </historial_ejecucion>`;
    }

    // Add RAG context from uploaded documents
    if (this.ragContext && this.ragContext.contextSummary) {
      contexts += `

  <contexto_documentos>
    <descripcion>Información relevante encontrada en los documentos de contexto cargados por el usuario</descripcion>
    <documentos_consultados>${this.ragContext.relevantDocuments.join(', ')}</documentos_consultados>
    <resumen>${this.ragContext.contextSummary}</resumen>
    <query_usada>${this.ragContext.augmentedQuery}</query_usada>
  </contexto_documentos>`;
    }

    return contexts;
  }
}
