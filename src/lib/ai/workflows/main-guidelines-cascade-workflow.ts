/**
 * Main Guidelines Cascade Workflow
 * 
 * Implements a cascaded architecture with distributed validation:
 * User → Classifier → Planner → [Workers in parallel] → Writer → Style Validator → User
 * 
 * Each worker has its own validator using guideline-based validation criteria.
 */

import { ChatConfig } from "../../utils/validation";
import { saveConversationMessage } from "../../db/repositories/conversations";
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
import { ExecutionContext, createNoOpExecutionContext, IExecutionContext } from '../../utils/execution-context';

// Cascade Architecture Imports
import { CascadeOrchestrator } from '../cascade/orchestrator';
import type { WorkerExecutionContext } from '../cascade/types';
import { loadConversationForLLM } from "../context";

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
 * @param executionContext - Optional execution context for tools that support deferred actions
 */
function registerTools(
  agent: GuidelineAgent, 
  uid: string, 
  userPhone: string, 
  userName: string,
  executionContext?: IExecutionContext
): void {
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

  // get_help tool with ExecutionContext for deferred message sending
  agent.registerTool(
    'get_help',
    'Solicitar ayuda de un agente humano',
    getHelpTool(uid, userPhone, userName, executionContext),
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

  // log_feedback tool with ExecutionContext for deferred message sending
  agent.registerTool(
    'log_feedback',
    'Registrar feedback del cliente y notificar al dueño',
    logFeedbackTool(uid, userPhone, userName, executionContext),
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
    getVisitStatusTool(uid, userPhone),
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

  if(userConfig.business.businessName) {
    agent.registerVariable(
      'nombre_negocio',
      () => `El agente trabaja para la inmobiliaria: ${userConfig.business.businessName}`
    );
  }

  if(userConfig.config.agentName) {
    agent.registerVariable(
      'nombre_agente',
      () => `Tu nombre es: ${userConfig.config.agentName}`
    );
  }

  if(userConfig.business.businessContext) {
    agent.registerVariable(
      'contexto_negocio',
      () => `Algunos datos del negocio: ${userConfig.business.businessContext}`
    );
  }

  console.log('[Workflow] Registered context variables');
}

/**
 * Main workflow using guidelines-based agent system
 * 
 * @param uid - User ID
 * @param session - WhatsApp session
 * @param body - Chat configuration with message data
 * @param workflowContext - Optional workflow context (e.g., isFromActivateAgent)
 * @param executionContext - Optional execution context for cancellation and deferred actions
 */
export async function mainGuidelinesWorkflow(
  uid: string,
  session: string,
  body: ChatConfig,
  workflowContext: WorkflowContext = {},
  executionContext?: IExecutionContext
): Promise<WorkflowResult | null> {
  const { userPhone, userName } = body;
  
  // Use provided context or create a no-op one for backward compatibility
  const execCtx = executionContext || createNoOpExecutionContext();
  const executionId = execCtx.executionId !== 'no-op' ? execCtx.executionId : undefined;

  console.log("\n========== GUIDELINES WORKFLOW START ==========");
  console.log(`User: ${userName} (${userPhone})`);
  if (executionId) {
    console.log(`[Workflow] ExecutionId: ${executionId}`);
  }

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
  await saveMessages(uid, userPhone, body, executionId);

  // Check if aborted after saving messages
  if (execCtx.isAborted()) {
    console.log("[Workflow] ⚠️ Execution aborted after saving messages");
    return null;
  }

  // ========== STEP 5: Get Conversation Context ==========
  const conversationContext = await loadConversationForLLM(uid, userPhone);

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
  // Pass executionContext to tools that support deferred actions (like getHelpTool)
  registerTools(agent, uid, userPhone, userName, execCtx);
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

  // ========== STEP 12: Match Guidelines (with dynamic ones) ==========
  const matcher = agent.matcher;
  // Update matcher guidelines too
  (matcher as any).guidelines = allGuidelines;
  
  const activeGuidelines = await matcher.matchGuidelines(
    conversationContext.messages,
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

  // Check if aborted before expensive reasoning
  if (execCtx.isAborted()) {
    console.log("[Workflow] ⚠️ Execution aborted before cascade processing");
    return null;
  }

  let result: { response: string; metadata?: any; executionTrace?: any[] };

  console.log('[Workflow] 🚀 Starting CASCADE architecture processing...');
  
  // Create the Cascade Orchestrator
  const cascadeOrchestrator = new CascadeOrchestrator({
    guidelineAgent: agent,
    uid,
    userPhone,
    userName,
    maxWorkerRetries: AI_CONFIG?.CASCADE?.MAX_WORKER_RETRIES ?? 2,
    maxWriterRetries: AI_CONFIG?.CASCADE?.MAX_WRITER_RETRIES ?? 2,
    workerTimeout: AI_CONFIG?.CASCADE?.WORKER_TIMEOUT_MS ?? 30000,
    parallelExecution: AI_CONFIG?.CASCADE?.ENABLE_PARALLEL_WORKERS ?? true,
    styleValidationEnabled: AI_CONFIG?.CASCADE?.ENABLE_STYLE_VALIDATION ?? true
  });

  // Execute the cascade workflow
  const cascadeResult = await cascadeOrchestrator.execute(
    messageToProcess,
    conversationContext.messages,
    activeGuidelines,
    glossaryContext,
    ragContext
  );

  result = {
    response: cascadeResult.response,
    metadata: {
      selectedGuidelines: cascadeResult.metadata?.executedGuidelines || [],
      executedAgents: cascadeResult.metadata?.workerResults?.length || 0,
      plannerReasoning: cascadeResult.metadata?.plan?.reasoning,
      classification: cascadeResult.metadata?.classification?.classification,
      writerIterations: cascadeResult.metadata?.writerIterations,
      workerResults: cascadeResult.metadata?.workerResults?.map(r => ({
        id: r.workerId,
        status: r.status,
        score: r.validation?.score
      }))
    },
    executionTrace: [] // Cascade doesn't use the same trace format
  };

  console.log('[Workflow] ✅ CASCADE processing completed');
  console.log('[Workflow] Classification:', cascadeResult.metadata?.classification?.classification);
  console.log('[Workflow] Plan reasoning:', cascadeResult.metadata?.plan?.reasoning?.substring(0, 100) + '...');
  console.log('[Workflow] Workers executed:', cascadeResult.metadata?.workerResults?.length || 0);
  console.log('[Workflow] Writer iterations:', cascadeResult.metadata?.writerIterations);
  console.log('[Workflow] Response generated');

  // Check if aborted after main processing
  if (execCtx.isAborted()) {
    console.log("[Workflow] ⚠️ Execution aborted after processing - not saving response");
    return null;
  }

  await saveConversationMessage(
    uid, 
    userPhone, 
    'assistant', 
    result.response,
    undefined, // messageId
    undefined, // isContext
    undefined, // customerName
    executionId // executionId for rollback
  );

  console.log("========== GUIDELINES CASCADE WORKFLOW END ==========\n");

  return {
    message: result.response,
    metadata: result.metadata || {
      selectedGuidelines: activeGuidelines.map((g: any) => g.guideline.id),
      executedAgents: 0,
    },
  };
}

// Export as default for easy migration
export const mainWorkflow = mainGuidelinesWorkflow;
