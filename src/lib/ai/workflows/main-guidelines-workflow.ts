/**
 * Main Guidelines Workflow
 * Simplified and modular version
 */

import { ChatConfig } from "@/lib/utils/validation";
import { saveConversationMessage } from "@/lib/db/repositories/conversations";
import { GuidelineAgent } from "../guideline-agent";
import { multimaiGuidelines } from "../guidelines/multimai-guidelines";
import { realEstateGlossary } from "../glossary/real-estate-terms";
import {
  searchPropertiesRAGTool,
  getPropertyInfoTool,
  getAvailabilityToVisitPropertyTool,
  createNewPropertyVisitTool,
  addVisitorToScheduledVisitTool,
  getHelpTool,
  askForAvailabilityTool,
  cancelVisitTool,
  rescheduleVisitTool,
  logFeedbackTool,
  createReminderTool,
  getVisitStatusTool,
  searchContextTool,
} from "../tools";
import { AI_CONFIG } from "../config";
import { quickResponser } from "../agents/quickResponser";
import { ChainOfThoughtAgent } from '../micro-agents/chain-of-thought-agent';
import {
  validateWorkflowInput,
  ensureCustomer,
  ensureUserConfig,
  saveMessages,
  determineMessageToProcess,
  getConversationContext,
  getExecutionContextSummary
} from './workflow-helpers';
import { getUserContextDocuments } from '../../db/repositories/user-documents';
import { generateDynamicGuidelines, mergeGuidelines } from '../guidelines/dynamic-guidelines';
import { ContextSearchAgent, type ContextSearchResult } from '../micro-agents/context-search-agent';
import { AgentConfigData, AgentBusinessData } from "../../db/types";

export interface WorkflowResult {
  message: string;
  needsHelp?: boolean;
  question?: string;
  metadata?: {
    selectedGuidelines: string[];
    executedAgents: number;
    errors?: string;
  };
}

export interface WorkflowContext {
  isFromActivateAgent?: boolean;
}

/**
 * Registers all tools with the guideline agent
 */
function registerTools(agent: GuidelineAgent, uid: string, userPhone: string, userName: string): void {
  agent.registerTool(
    'search_properties',
    'Buscar propiedades según criterios del usuario',
    searchPropertiesRAGTool(uid, userPhone),
    ['search_properties']
  );

  agent.registerTool(
    'get_property_info',
    'Obtener información detallada de una propiedad específica',
    getPropertyInfoTool(uid),
    ['get_property_detail', 'show_photos', 'show_interest', 'property_reference_context', 'search_properties']
  );

  agent.registerTool(
    'get_availability',
    'Verificar disponibilidad de visitas programadas',
    getAvailabilityToVisitPropertyTool(uid, userPhone),
    ['check_visit_availability']
  );

  agent.registerTool(
    'create_visit',
    'Crear una nueva visita a una propiedad con fecha y hora confirmadas por el cliente',
    createNewPropertyVisitTool(uid, userPhone, userName),
    ['schedule_new_visit']
  );

  agent.registerTool(
    'add_visitor',
    'Agregar visitante a una visita existente con fecha y hora confirmadas por el cliente',
    addVisitorToScheduledVisitTool(uid, userPhone, userName),
    ['schedule_new_visit']
  );

  agent.registerTool(
    'get_help',
    'Solicitar ayuda de un agente humano',
    getHelpTool(uid, userPhone, userName),
    ['get_human_help']
  );

  agent.registerTool(
    'ask_availability',
    'Consultar al dueño sobre disponibilidad',
    askForAvailabilityTool(uid, userPhone, userName),
    ['check_visit_availability']
  );

  agent.registerTool(
    'cancel_visit',
    'Cancelar una visita programada del cliente',
    cancelVisitTool(uid, userPhone, userName),
    ['cancel_visit']
  );

  agent.registerTool(
    'reschedule_visit',
    'Reprogramar una visita existente del cliente',
    rescheduleVisitTool(uid, userPhone, userName),
    ['reschedule_visit']
  );

  agent.registerTool(
    'log_feedback',
    'Registrar feedback del cliente y notificar al dueño',
    logFeedbackTool(uid, userPhone, userName),
    ['collect_feedback']
  );

  agent.registerTool(
    'create_reminder',
    'Crear un recordatorio para el cliente con fecha y hora específica',
    createReminderTool(uid, userPhone, userName),
    ['create_reminder']
  );

  agent.registerTool(
    'get_visit_status',
    'Consultar el estado y detalles de una visita programada',
    getVisitStatusTool(uid),
    ['check_visit_status', 'cancel_visit', 'reschedule_visit']
  );

  agent.registerTool(
    'search_context',
    'Buscar información en los documentos de contexto cargados',
    searchContextTool(uid, userPhone),
    ['context_search']
  );
}

/**
 * Registers context variables with the guideline agent
 */
function registerContextVariables(
  agent: GuidelineAgent,
  customerName: string,
  customerPhone: string,
  userConfig: { config: AgentConfigData; business: AgentBusinessData }
): void {
  
  agent.registerVariable(
    'fecha_hora_actual',
    () => {
      const now = new Date();
      const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
      const months = [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
      ];

      const dayName = days[now.getDay()];
      const monthName = months[now.getMonth()];
      const dateStr = `${dayName}, ${now.getDate()} de ${monthName} de ${now.getFullYear()}`;
      const isoDate = now.toISOString().split('T')[0];

      return `Hoy es ${dateStr} (${isoDate}) y son las ${now.getHours()}:${now.getMinutes()}`;
    },
    'Fecha actual en formato legible para el agente'
  );

  agent.registerVariable(
    'nombre_usuario',
    () => `El usuario se llama: ${customerName}`
  );

  agent.registerVariable(
    'numero_de_telefono',
    () => `El número de teléfono del usuario es: ${customerPhone}`
  );

  agent.registerVariable(
    'nombre_negocio',
    () => `El agente trabaja para la inmobiliaria: ${userConfig.business.businessName}`
  );

  agent.registerVariable(
    'nombre_agente',
    () => `Tu nombre es: ${userConfig.config.agentName}`
  );

  console.log('[Workflow] Registered context variables');
}

/**
 * Main workflow using guidelines-based agent system
 */
export async function mainGuidelinesWorkflow(
  uid: string,
  session: string,
  body: ChatConfig,
  workflowContext: WorkflowContext = {}
): Promise<WorkflowResult | null> {
  const { userPhone, userName } = body;

  console.log("\n========== GUIDELINES WORKFLOW START ==========");
  console.log(`User: ${userName} (${userPhone})`);

  // ========== STEP 1: Validation ==========
  const isValid = await validateWorkflowInput(uid, body);
  if (!isValid) {
    console.log("[Workflow] Validation failed, skipping");
    return null;
  }

  // ========== STEP 2: Ensure Customer ==========
  await ensureCustomer(uid, userPhone, userName);

  // ========== STEP 3: Get User Configuration ==========
  const userConfig = await ensureUserConfig(uid, session);
  if (!userConfig) {
    console.log("[Workflow] User config not found");
    return null;
  }

  // ========== STEP 4: Save Messages ==========
  await saveMessages(uid, userPhone, body);

  // ========== STEP 5: Get Conversation Context ==========
  const { context: conversationContext, history } = await getConversationContext(uid, userPhone, session);

  // ========== STEP 6: Quick Response (if not from activate agent) ==========
  if (!workflowContext.isFromActivateAgent) {
    // Fire and forget - don't wait
    quickResponser(uid, userPhone, session, conversationContext.messages)
      .catch(error => console.error("[Workflow] Quick responder error:", error));
  }

  // ========== STEP 7: Determine Message to Process ==========
  const messageToProcess = determineMessageToProcess(body);

  // ========== STEP 8: Create Guideline Agent ==========
  const agent = new GuidelineAgent(
    multimaiGuidelines,
    realEstateGlossary,
    {
      streaming: AI_CONFIG?.ENABLE_STREAMING ?? false,
      enableCritique: AI_CONFIG?.ENABLE_CRITIQUE ?? false,
      maxSteps: AI_CONFIG?.MAX_STEPS ?? 3,
      guidelineThreshold: AI_CONFIG?.GUIDELINE_THRESHOLD ?? 0.7
    }
  );

  // ========== STEP 9: Register Tools and Variables ==========
  registerTools(agent, uid, userPhone, userName);
  registerContextVariables(agent, userName, userPhone, userConfig);

  // ========== STEP 10: Load User Documents and Generate Dynamic Guidelines ==========
  console.log('[Workflow] Loading user context documents...');
  const userDocuments = await getUserContextDocuments(uid);
  console.log(`[Workflow] Found ${userDocuments.length} context documents`);

  // Generate dynamic guidelines based on user documents
  const dynamicGuidelines = generateDynamicGuidelines(userDocuments);
  console.log(`[Workflow] Generated ${dynamicGuidelines.length} dynamic guidelines`);

  // Merge static and dynamic guidelines
  const allGuidelines = mergeGuidelines(multimaiGuidelines, dynamicGuidelines);

  // Update agent with merged guidelines
  (agent as any).guidelines = allGuidelines;

  // ========== STEP 11: Get Execution Context Summary ==========
  const executionContextSummary = await getExecutionContextSummary(
    uid,
    userPhone,
    messageToProcess,
    history,
    0.6 // threshold
  );

  // ========== STEP 12: Match Guidelines (with dynamic ones) ==========
  const matcher = (agent as any).matcher;
  // Update matcher guidelines too
  (matcher as any).guidelines = allGuidelines;
  
  const activeGuidelines = await matcher.matchGuidelines(
    conversationContext,
    AI_CONFIG?.GUIDELINE_THRESHOLD ?? 0.7
  );

  console.log('[Workflow] Active guidelines:', activeGuidelines.map((g: any) => g.guideline.id));

  // ========== STEP 13: Execute Context Search Agent (if active) ==========
  let ragContext: ContextSearchResult | null = null;
  const contextSearchGuideline = activeGuidelines.find(
    (g: any) => g.guideline.id === 'context_search'
  );

  if (contextSearchGuideline && userDocuments.length > 0) {
    console.log('[Workflow] Context search guideline active, executing ContextSearchAgent...');
    
    const contextSearchAgent = new ContextSearchAgent(uid, userDocuments);
    
    // Get conversation summary for context
    const conversationSummary = conversationContext.messages
      .slice(-5)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    ragContext = await contextSearchAgent.getContextResult(
      messageToProcess,
      conversationSummary
    );

    console.log(`[Workflow] Context search completed: ${ragContext.relevantDocuments.length} documents found`);
    console.log(`[Workflow] Context summary: ${ragContext.contextSummary.substring(0, 200)}...`);
  } else if (userDocuments.length > 0) {
    console.log('[Workflow] Context search guideline NOT active (documents available but not relevant)');
  }

  // ========== STEP 14: Check Glossary Terms ==========
  let glossaryContext = '';
  if (activeGuidelines.length > 0) {
    console.log('[Workflow] Checking glossary terms...');
    const glossaryTerms = await agent.checkGlossary(messageToProcess, activeGuidelines);

    if (glossaryTerms.length > 0) {
      console.log(`[Workflow] Found ${glossaryTerms.length} glossary terms`);
      glossaryContext = glossaryTerms.map(t => `${t.term}: ${t.definition}`).join('\n');
    }
  }

  // ========== STEP 15: Chain of Thought Reasoning ==========
  console.log('[Workflow] Generating chain of thought reasoning...');
  const availableTools = agent.getRegisteredTools();

  const cotAgent = new ChainOfThoughtAgent(
    allGuidelines, // Use merged guidelines
    agent,
    executionContextSummary,
    availableTools,
    null, // microAgentsResults - removed
    activeGuidelines,
    glossaryContext,
    executionContextSummary,
    ragContext // Pass RAG context
  );

  const cotResult = await cotAgent.execute({
    userMessage: messageToProcess,
    conversationContext,
    activeGuidelines,
    uid,
    userPhone,
    userName
  });

  const chainOfThought = cotResult.success ? cotResult.response : null;

  if (chainOfThought) {
    console.log('[Workflow] Chain of thought generated');
  } else {
    console.log('[Workflow] Chain of thought generation failed');
  }

  // ========== STEP 16: Process with Main Agent ==========
  const result = await agent.process(
    messageToProcess,
    conversationContext,
    3, // maxSteps
    activeGuidelines,
    null, // microAgentsContext - removed
    chainOfThought,
    ragContext // Pass RAG context for composer
  );

  console.log('[Workflow] Response generated');

  // ========== STEP 17: Save Assistant Response ==========
  await saveConversationMessage(uid, userPhone, 'assistant', result.response);

  console.log("========== GUIDELINES WORKFLOW END ==========\n");

  return {
    message: result.response,
    metadata: {
      selectedGuidelines: result.state.activeGuidelines.map((g: any) => g.guideline.id),
      executedAgents: result.executionTrace.filter((t: any) => t.step === 'tool_execution').length,
    },
  };
}

// Export as default for easy migration
export const mainWorkflow = mainGuidelinesWorkflow;
