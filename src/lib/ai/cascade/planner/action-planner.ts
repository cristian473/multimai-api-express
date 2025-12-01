/**
 * Action Planner
 * Analyzes user message and active guidelines to create an execution plan
 * Decides whether to execute workers or go directly to the writer
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { getModel } from '../../openrouter';
import { AI_CONFIG } from '../../config';
import type { GuidelineMatch } from '../../types/guideline';
import type { LLMMessage } from '../../context/conversation-loader';
import type { ActionPlan, ClassificationResult } from '../types';
import { WORKER_REGISTRY, getActiveWorkers } from '../types';

// Zod schemas for structured output
// Task types:
// - 'reasoning': Internal analysis/thinking step (no worker needed)
// - 'context_search': Search in conversation history or context
// - 'worker_call': Call a specific worker to perform an action
const TaskSchema = z.object({
  id: z.string().describe('ID único de la tarea (ej: "task_1", "task_2")'),
  step: z.number().describe('Número de paso en la secuencia (1, 2, 3...)'),
  description: z.string().describe('Descripción clara de qué hacer en este paso. Escríbelo de forma natural.'),
  type: z.enum(['reasoning', 'context_search', 'worker_call']).describe('Tipo de tarea: reasoning=análisis interno, context_search=buscar en historial, worker_call=llamar a un worker'),
  workerId: z.string().describe('ID del worker a llamar. Solo requerido si type="worker_call". Dejar vacío "" si no aplica.'),
  dependsOn: z.array(z.string()).describe('IDs de tareas que deben completarse antes. Array vacío [] si no hay dependencias.')
});

const ActionPlanSchema = z.object({
  tasks: z.array(TaskSchema).describe('Lista secuencial de tareas a realizar para responder al usuario'),
  criticalPath: z.boolean().describe('Si es true, abortar todo si una tarea crítica falla'),
  directToWriter: z.boolean().describe('Si es true, no hay tareas complejas, ir directo al writer'),
  reasoning: z.string().describe('Explicación general del plan'),
  estimatedComplexity: z.enum(['low', 'medium', 'high']).describe('Complejidad estimada')
});

const ClassificationSchema = z.object({
  classification: z.enum(['requires_action', 'text_only']).describe('Tipo de mensaje'),
  confidence: z.number().min(0).max(1).describe('Confianza en la clasificación'),
  reasoning: z.string().describe('Razón de la clasificación'),
  detectedIntents: z.array(z.string()).describe('Intenciones detectadas en el mensaje')
});

export interface PlannerInput {
  userMessage: string;
  messages: LLMMessage[];
  activeGuidelines: GuidelineMatch[];
}

export interface PlannerOutput {
  classification: ClassificationResult;
  plan: ActionPlan;
}

export class ActionPlanner {
  private model: ReturnType<typeof getModel>;
  private clasiffierModel: ReturnType<typeof getModel>;

  constructor() {
    this.model = getModel(AI_CONFIG?.CASCADE?.PLANNER_MODEL ?? AI_CONFIG?.COMPOSER_MODEL_MEDIUM ?? 'openai/gpt-4o-mini');  
    this.clasiffierModel = getModel(AI_CONFIG?.CASCADE?.CLASSIFIER_MODEL ?? AI_CONFIG?.COMPOSER_MODEL_MEDIUM ?? 'openai/gpt-4o-mini');
  }

  /**
   * Build the classification prompt
   */
  private buildClassificationPrompt(input: PlannerInput): string {
    let prompt = `<classification_prompt>\n\n`;

    prompt += `  <role>\n`;
    prompt += `    <descripcion>Eres un clasificador de mensajes para un agente inmobiliario</descripcion>\n`;
    prompt += `    <objetivo>Determinar si el mensaje requiere ejecutar acciones (tools) o solo una respuesta de texto</objetivo>\n`;
    prompt += `  </role>\n\n`;

    prompt += `  <mensaje_usuario>\n`;
    prompt += `    <contenido>${input.userMessage}</contenido>\n`;
    prompt += `  </mensaje_usuario>\n\n`;

    // Recent conversation context
    const recentMessages = input.messages.slice(-5);
    if (recentMessages.length > 0) {
      prompt += `  <contexto_conversacion>\n`;
      recentMessages.forEach(msg => {
        prompt += `    <mensaje role="${msg.role}">${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}</mensaje>\n`;
      });
      prompt += `  </contexto_conversacion>\n\n`;
    }

    // Active guidelines
    if (input.activeGuidelines.length > 0) {
      prompt += `  <guidelines_activas>\n`;
      input.activeGuidelines.forEach(match => {
        const g = match.guideline;
        prompt += `    <guideline id="${g.id}" score="${match.score.toFixed(2)}">\n`;
        prompt += `      <tiene_herramientas>${g.tools && g.tools.length > 0 ? 'SÍ: ' + g.tools.join(', ') : 'NO'}</tiene_herramientas>\n`;
        prompt += `    </guideline>\n`;
      });
      prompt += `  </guidelines_activas>\n\n`;
    }

    prompt += `  <criterios_clasificacion>\n`;
    prompt += `    <requires_action>\n`;
    prompt += `      <descripcion>El mensaje requiere ejecutar herramientas/acciones</descripcion>\n`;
    prompt += `      <ejemplos>\n`;
    prompt += `        <ejemplo>Buscar propiedades con criterios específicos</ejemplo>\n`;
    prompt += `        <ejemplo>Agendar, cancelar o reprogramar visitas</ejemplo>\n`;
    prompt += `        <ejemplo>Consultar disponibilidad de propiedades</ejemplo>\n`;
    prompt += `        <ejemplo>Escalar al dueño/agente humano</ejemplo>\n`;
    prompt += `        <ejemplo>Guardar feedback del usuario</ejemplo>\n`;
    prompt += `      </ejemplos>\n`;
    prompt += `    </requires_action>\n`;
    prompt += `    <text_only>\n`;
    prompt += `      <descripcion>El mensaje solo requiere una respuesta de texto</descripcion>\n`;
    prompt += `      <ejemplos>\n`;
    prompt += `        <ejemplo>Saludos simples (hola, buenos días)</ejemplo>\n`;
    prompt += `        <ejemplo>Preguntas generales sobre el servicio</ejemplo>\n`;
    prompt += `        <ejemplo>Agradecimientos o despedidas</ejemplo>\n`;
    prompt += `        <ejemplo>Solicitud de aclaración (sin contexto de propiedad)</ejemplo>\n`;
    prompt += `      </ejemplos>\n`;
    prompt += `    </text_only>\n`;
    prompt += `  </criterios_clasificacion>\n\n`;

    prompt += `</classification_prompt>`;

    return prompt;
  }

  /**
   * Build the planning prompt
   */
  private buildPlanningPrompt(input: PlannerInput, classification: ClassificationResult): string {
    let prompt = `<planning_prompt>\n\n`;

    prompt += `  <role>\n`;
    prompt += `    <descripcion>Eres un planificador de acciones para un agente inmobiliario</descripcion>\n`;
    prompt += `    <objetivo>Crear un plan de ejecución detallado para los workers especializados</objetivo>\n`;
    prompt += `  </role>\n\n`;

    prompt += `  <clasificacion_mensaje>\n`;
    prompt += `    <tipo>${classification.classification}</tipo>\n`;
    prompt += `    <confianza>${classification.confidence.toFixed(2)}</confianza>\n`;
    prompt += `    <razon>${classification.reasoning}</razon>\n`;
    prompt += `    <intenciones>${classification.detectedIntents.join(', ')}</intenciones>\n`;
    prompt += `  </clasificacion_mensaje>\n\n`;

    prompt += `  <mensaje_usuario>\n`;
    prompt += `    <contenido>${input.userMessage}</contenido>\n`;
    prompt += `  </mensaje_usuario>\n\n`;

    // Guidelines context
    if (input.activeGuidelines.length > 0) {
      prompt += `  <guidelines_activas>\n`;
      input.activeGuidelines.forEach(match => {
        const g = match.guideline;
        prompt += `    <guideline id="${g.id}" score="${match.score.toFixed(2)}">\n`;
        prompt += `      <condicion>${g.condition}</condicion>\n`;
        prompt += `      <accion>${g.action}</accion>\n`;
        if (g.tools && g.tools.length > 0) {
          prompt += `      <herramientas>${g.tools.join(', ')}</herramientas>\n`;
        }
        prompt += `    </guideline>\n`;
      });
      prompt += `  </guidelines_activas>\n\n`;
    }

    // Available workers
    const activeWorkerIds = new Set<string>();
    input.activeGuidelines.forEach(match => {
      const workers = getActiveWorkers([match.guideline.id]);
      workers.forEach(w => activeWorkerIds.add(w.id));
    });

    prompt += `  <workers_disponibles>\n`;
    WORKER_REGISTRY.filter(w => w.enabled).forEach(worker => {
      const isActive = activeWorkerIds.has(worker.id);
      prompt += `    <worker id="${worker.id}" activo="${isActive ? 'SÍ' : 'NO'}">\n`;
      prompt += `      <nombre>${worker.name}</nombre>\n`;
      prompt += `      <descripcion>${worker.description}</descripcion>\n`;
      prompt += `      <guidelines_asociadas>${worker.associatedGuidelineIds.join(', ')}</guidelines_asociadas>\n`;
      prompt += `      <herramientas>${worker.toolNames.join(', ')}</herramientas>\n`;
      prompt += `    </worker>\n`;
    });
    prompt += `  </workers_disponibles>\n\n`;

    

    prompt += `  <instrucciones_planificacion>\n`;
    prompt += `    <instruccion>Si classification es "text_only", establece directToWriter=true y tasks=[]</instruccion>\n`;
    prompt += `    <instruccion>Si classification es "requires_action", desglosa el mensaje en PASOS SECUENCIALES</instruccion>\n`;
    prompt += `    <instruccion>Cada tarea debe tener un type:</instruccion>\n`;
    prompt += `    <tipos_tarea>\n`;
    prompt += `      <tipo name="reasoning">Análisis interno, deducción o interpretación. No requiere worker.</tipo>\n`;
    prompt += `      <tipo name="context_search">Buscar información en el historial de conversación o contexto. No requiere worker.</tipo>\n`;
    prompt += `      <tipo name="worker_call">Ejecutar un worker específico. Requiere workerId válido.</tipo>\n`;
    prompt += `    </tipos_tarea>\n`;
    prompt += `    <instruccion>Solo usa type="worker_call" cuando realmente necesites llamar a un worker</instruccion>\n`;
    prompt += `    <instruccion>Usa dependsOn para indicar qué tareas deben completarse antes</instruccion>\n`;
    prompt += `    <instruccion>La descripción debe ser clara y natural, explicando QUÉ hacer</instruccion>\n`;
    prompt += `  </instrucciones_planificacion>\n\n`;

    prompt += `  <ejemplo_plan>\n`;
    prompt += `    <mensaje_ejemplo>quería saber si la visita fue agendada el 30 o el 1, y también si hay otras opciones en pacheco que acepten mascotas</mensaje_ejemplo>\n`;
    prompt += `    <tasks_ejemplo>\n`;
    prompt += `      <task id="task_1" step="1" type="context_search" workerId="">\n`;
    prompt += `        <description>Buscar en el historial de conversación a qué visita hace referencia el usuario y extraer el ID de la propiedad o visita mencionada</description>\n`;
    prompt += `        <dependsOn>[]</dependsOn>\n`;
    prompt += `      </task>\n`;
    prompt += `      <task id="task_2" step="2" type="reasoning" workerId="">\n`;
    prompt += `        <description>Analizar el contexto encontrado para determinar el ID exacto de la visita y las fechas mencionadas (30 o 1)</description>\n`;
    prompt += `        <dependsOn>["task_1"]</dependsOn>\n`;
    prompt += `      </task>\n`;
    prompt += `      <task id="task_3" step="3" type="worker_call" workerId="visit_worker">\n`;
    prompt += `        <description>Consultar el estado actual de la visita identificada para confirmar si fue agendada y en qué fecha</description>\n`;
    prompt += `        <dependsOn>["task_2"]</dependsOn>\n`;
    prompt += `      </task>\n`;
    prompt += `      <task id="task_4" step="4" type="worker_call" workerId="search_worker">\n`;
    prompt += `        <description>Buscar propiedades disponibles en Pacheco que acepten mascotas como alternativas</description>\n`;
    prompt += `        <dependsOn>[]</dependsOn>\n`;
    prompt += `      </task>\n`;
    prompt += `    </tasks_ejemplo>\n`;
    prompt += `  </ejemplo_plan>\n\n`;

    prompt += `  <ejemplo_simple>\n`;
    prompt += `    <mensaje_ejemplo>Hola, cómo estás?</mensaje_ejemplo>\n`;
    prompt += `    <plan_ejemplo>directToWriter=true, tasks=[] (saludo simple, no requiere acciones)</plan_ejemplo>\n`;
    prompt += `  </ejemplo_simple>\n\n`;

    prompt += `</planning_prompt>`;

    return prompt;
  }

  /**
   * Classify the message
   */
  async classify(input: PlannerInput): Promise<ClassificationResult> {
    console.log('[ActionPlanner] Classifying message...');

    const classificationPrompt = this.buildClassificationPrompt(input);

    const result = await generateObject({
      model: this.clasiffierModel,
      schema: ClassificationSchema,
      system: classificationPrompt,
      prompt: 'Clasifica el mensaje del usuario.',
      temperature: 0.2
    });

    console.log(`[ActionPlanner] Classification: ${result.object.classification} (confidence: ${result.object.confidence})`);

    return result.object as ClassificationResult;
  }

  /**
   * Create the execution plan
   */
  async plan(input: PlannerInput): Promise<PlannerOutput> {
    console.log('[ActionPlanner] Starting planning process...');

    // Step 1: Classify the message
    const classification = await this.classify(input);

    // Step 2: If text_only, return simple plan
    if (classification.classification === 'text_only') {
      console.log('[ActionPlanner] Text-only message, skipping workers');
      return {
        classification,
        plan: {
          tasks: [],
          criticalPath: false,
          directToWriter: true,
          reasoning: 'Mensaje clasificado como solo texto, no requiere ejecución de herramientas',
          estimatedComplexity: 'low'
        }
      };
    }

    // Step 3: Generate execution plan for requires_action
    console.log('[ActionPlanner] Generating execution plan...');

    const planningPrompt = this.buildPlanningPrompt(input, classification);

    const result = await generateObject({
      model: this.model,
      schema: ActionPlanSchema,
      system: planningPrompt,
      prompt: 'Genera el plan de acción para los workers.',
      temperature: 0.3
    });

    console.log('[ActionPlanner] Planning result:', JSON.stringify(result.object, null, 2));

    // Raw result with new task structure
    const rawPlan = result.object as {
      tasks: Array<{
        id: string;
        step: number;
        description: string;
        type: 'reasoning' | 'context_search' | 'worker_call';
        workerId: string;
        dependsOn: string[];
      }>;
      criticalPath: boolean;
      directToWriter: boolean;
      reasoning: string;
      estimatedComplexity: 'low' | 'medium' | 'high';
    };

    // Validate tasks
    const validTasks: ActionPlan['tasks'] = [];
    
    for (const task of rawPlan.tasks) {
      // For worker_call type, validate worker exists
      if (task.type === 'worker_call' && task.workerId) {
        const workerExists = WORKER_REGISTRY.some(w => w.id === task.workerId && w.enabled);
        if (!workerExists) {
          console.warn(`[ActionPlanner] Invalid worker ID in task ${task.id}: ${task.workerId}`);
          // Still add the task but clear the workerId
          task.workerId = '';
          task.type = 'reasoning'; // Downgrade to reasoning
        }
      }

      console.log(`[ActionPlanner] Task ${task.step} (${task.type}): "${task.description}"`);

      validTasks.push({
        id: task.id,
        step: task.step,
        description: task.description,
        type: task.type,
        workerId: task.workerId || '',
        dependsOn: task.dependsOn || [],
        status: 'pending'
      });
    }

    // Sort tasks by step number
    validTasks.sort((a, b) => a.step - b.step);

    const finalPlan: ActionPlan = {
      tasks: validTasks,
      criticalPath: rawPlan.criticalPath,
      directToWriter: rawPlan.directToWriter,
      reasoning: rawPlan.reasoning,
      estimatedComplexity: rawPlan.estimatedComplexity
    };

    console.log(`[ActionPlanner] Plan created with ${finalPlan.tasks.length} tasks`);
    const workerTasks = finalPlan.tasks.filter(t => t.type === 'worker_call');
    console.log(`[ActionPlanner] Worker calls: ${workerTasks.map(t => t.workerId).join(', ') || 'none'}`);

    return {
      classification,
      plan: finalPlan
    };
  }

  /**
   * Quick classification without full planning (useful for simple checks)
   */
  async quickClassify(userMessage: string, activeGuidelineIds: string[]): Promise<'requires_action' | 'text_only'> {
    // Simple heuristic-based classification
    const hasToolGuidelines = activeGuidelineIds.some(id => {
      const worker = WORKER_REGISTRY.find(w => w.associatedGuidelineIds.includes(id));
      return worker !== undefined;
    });

    // Keywords that typically indicate action
    const actionKeywords = [
      'buscar', 'busco', 'quiero', 'necesito',
      'agendar', 'reservar', 'programar',
      'cancelar', 'reprogramar',
      'disponibilidad', 'horarios',
      'pregunta', 'contacta', 'habla con',
      'feedback', 'calificación'
    ];

    const messageWords = userMessage.toLowerCase();
    const hasActionKeyword = actionKeywords.some(kw => messageWords.includes(kw));

    if (hasToolGuidelines || hasActionKeyword) {
      return 'requires_action';
    }

    return 'text_only';
  }
}

