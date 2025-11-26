/**
 * Synthetic Conversation Scenarios
 *
 * Defines test scenarios for generating synthetic conversations
 * Used by scripts/generate-conversations.ts
 */

export interface ConversationScenario {
  id: string;
  category: 'search' | 'visit_scheduling' | 'owner_escalation' | 'visit_management' | 'edge_case';
  userGoal: string;
  userPersonality: 'urgent' | 'detailed' | 'confused' | 'formal' | 'casual' | 'frustrated';
  expectedFlow: string[];
  expectedTools: string[];
  expectedGuidelines: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  shouldSucceed: boolean;
  commonProblemType?: 'tool_failure' | 'missing_guideline' | 'wrong_response' | 'escalation_to_human';
  description: string;
}

export const syntheticScenarios: ConversationScenario[] = [
  // === BÚSQUEDAS (1-4) ===
  {
    id: 'search_simple',
    category: 'search',
    userGoal: 'Buscar departamento de 2 habitaciones en Palermo',
    userPersonality: 'casual',
    expectedFlow: ['greeting', 'search_properties', 'show_results', 'offer_visit'],
    expectedTools: ['search_properties'],
    expectedGuidelines: ['greeting', 'search_properties', 'show_interest'],
    difficulty: 'easy',
    shouldSucceed: true,
    description: 'Búsqueda simple y exitosa con criterios claros'
  },

  {
    id: 'search_monoambiente',
    category: 'search',
    userGoal: 'Buscar monoambiente (sinónimo de 1 dormitorio)',
    userPersonality: 'casual',
    expectedFlow: ['greeting', 'search_properties', 'show_results'],
    expectedTools: ['search_properties'],
    expectedGuidelines: ['greeting', 'search_properties'],
    difficulty: 'medium',
    shouldSucceed: true,
    commonProblemType: 'tool_failure',
    description: 'Búsqueda usando término coloquial que debe ser mapeado'
  },

  {
    id: 'search_no_results',
    category: 'search',
    userGoal: 'Buscar propiedad en zona que no existe en la base de datos',
    userPersonality: 'detailed',
    expectedFlow: ['greeting', 'search_properties', 'handle_empty_results', 'suggest_alternatives'],
    expectedTools: ['search_properties'],
    expectedGuidelines: ['greeting', 'search_properties'],
    difficulty: 'medium',
    shouldSucceed: false,
    commonProblemType: 'wrong_response',
    description: 'Búsqueda sin resultados - debe sugerir zonas alternativas'
  },

  {
    id: 'search_multiple_criteria',
    category: 'search',
    userGoal: 'Buscar propiedad con múltiples criterios específicos (ubicación, precio, características)',
    userPersonality: 'detailed',
    expectedFlow: ['greeting', 'gather_criteria', 'search_properties', 'show_results'],
    expectedTools: ['search_properties'],
    expectedGuidelines: ['greeting', 'search_properties'],
    difficulty: 'medium',
    shouldSucceed: true,
    description: 'Búsqueda compleja con varios filtros'
  },

  // === AGENDAMIENTO DE VISITAS (5-8) ===
  {
    id: 'schedule_with_id',
    category: 'visit_scheduling',
    userGoal: 'Agendar visita teniendo el ID de la propiedad',
    userPersonality: 'formal',
    expectedFlow: ['request_visit', 'confirm_datetime', 'create_visit', 'confirm_booking'],
    expectedTools: ['create_visit'],
    expectedGuidelines: ['schedule_new_visit'],
    difficulty: 'easy',
    shouldSucceed: true,
    description: 'Agendamiento directo con toda la información'
  },

  {
    id: 'schedule_without_id',
    category: 'visit_scheduling',
    userGoal: 'Agendar visita mencionando propiedad sin tener el ID',
    userPersonality: 'casual',
    expectedFlow: ['request_visit', 'search_properties', 'confirm_property', 'confirm_datetime', 'create_visit'],
    expectedTools: ['search_properties', 'create_visit'],
    expectedGuidelines: ['schedule_new_visit', 'search_properties'],
    difficulty: 'medium',
    shouldSucceed: true,
    commonProblemType: 'tool_failure',
    description: 'Debe buscar la propiedad primero antes de agendar'
  },

  {
    id: 'schedule_missing_datetime',
    category: 'visit_scheduling',
    userGoal: 'Intentar agendar sin confirmar fecha y hora',
    userPersonality: 'urgent',
    expectedFlow: ['request_visit', 'ask_datetime', 'wait_confirmation'],
    expectedTools: [],
    expectedGuidelines: ['schedule_new_visit'],
    difficulty: 'medium',
    shouldSucceed: false,
    commonProblemType: 'tool_failure',
    description: 'No debe ejecutar create_visit sin fecha/hora confirmada'
  },

  {
    id: 'schedule_to_existing_visit',
    category: 'visit_scheduling',
    userGoal: 'Unirse a una visita grupal existente',
    userPersonality: 'casual',
    expectedFlow: ['request_visit', 'get_availability', 'add_visitor', 'confirm_booking'],
    expectedTools: ['get_availability', 'add_visitor'],
    expectedGuidelines: ['check_visit_availability', 'schedule_new_visit'],
    difficulty: 'medium',
    shouldSucceed: true,
    description: 'Debe usar add_visitor en lugar de create_visit'
  },

  // === ESCALACIÓN AL DUEÑO (9-11) ===
  {
    id: 'ask_owner_explicit',
    category: 'owner_escalation',
    userGoal: 'Solicitar explícitamente hablar con el dueño',
    userPersonality: 'formal',
    expectedFlow: ['request_owner', 'get_help', 'confirm_escalation'],
    expectedTools: ['get_help'],
    expectedGuidelines: ['get_human_help'],
    difficulty: 'easy',
    shouldSucceed: true,
    commonProblemType: 'escalation_to_human',
    description: 'Debe usar get_help inmediatamente cuando usuario pide hablar con dueño'
  },

  {
    id: 'ask_owner_multiple_properties',
    category: 'owner_escalation',
    userGoal: 'Preguntar disponibilidad de visitas para varias propiedades a la vez',
    userPersonality: 'detailed',
    expectedFlow: ['ask_availability_multiple', 'get_help'],
    expectedTools: ['get_help'],
    expectedGuidelines: ['get_human_help'],
    difficulty: 'medium',
    shouldSucceed: true,
    commonProblemType: 'escalation_to_human',
    description: 'Debe escalar al dueño para consultas de múltiples propiedades'
  },

  {
    id: 'ask_owner_special_conditions',
    category: 'owner_escalation',
    userGoal: 'Preguntar sobre políticas de mascotas o condiciones especiales',
    userPersonality: 'detailed',
    expectedFlow: ['ask_special_condition', 'get_help'],
    expectedTools: ['get_help'],
    expectedGuidelines: ['get_human_help'],
    difficulty: 'medium',
    shouldSucceed: true,
    commonProblemType: 'missing_guideline',
    description: 'Debe escalar preguntas sobre políticas no en base de datos'
  },

  // === GESTIÓN DE VISITAS (12-13) ===
  {
    id: 'cancel_visit',
    category: 'visit_management',
    userGoal: 'Cancelar una visita previamente programada',
    userPersonality: 'formal',
    expectedFlow: ['request_cancellation', 'confirm_cancellation', 'cancel_visit', 'offer_help'],
    expectedTools: ['cancel_visit'],
    expectedGuidelines: ['cancel_visit'],
    difficulty: 'medium',
    shouldSucceed: true,
    description: 'Cancelación exitosa de visita'
  },

  {
    id: 'reschedule_visit',
    category: 'visit_management',
    userGoal: 'Reprogramar una visita existente a nueva fecha',
    userPersonality: 'casual',
    expectedFlow: ['request_reschedule', 'reschedule_visit', 'get_availability', 'create_visit'],
    expectedTools: ['reschedule_visit', 'get_availability', 'create_visit'],
    expectedGuidelines: ['reschedule_visit', 'check_visit_availability', 'schedule_new_visit'],
    difficulty: 'hard',
    shouldSucceed: true,
    description: 'Reprogramación completa de visita'
  },

  // === EDGE CASES (14-20) ===
  {
    id: 'property_requirements',
    category: 'edge_case',
    userGoal: 'Preguntar sobre requisitos para alquilar',
    userPersonality: 'detailed',
    expectedFlow: ['ask_requirements', 'provide_requirements_or_escalate'],
    expectedTools: ['get_property_info', 'get_help'],
    expectedGuidelines: ['get_property_detail', 'get_human_help'],
    difficulty: 'medium',
    shouldSucceed: true,
    commonProblemType: 'missing_guideline',
    description: 'Consulta sobre requisitos - puede estar en data o necesitar escalación'
  },

  {
    id: 'frustrated_user',
    category: 'edge_case',
    userGoal: 'Usuario frustrado porque una herramienta falló previamente',
    userPersonality: 'frustrated',
    expectedFlow: ['express_frustration', 'apologize', 'offer_alternative', 'get_help'],
    expectedTools: ['get_help'],
    expectedGuidelines: ['get_human_help'],
    difficulty: 'hard',
    shouldSucceed: true,
    commonProblemType: 'tool_failure',
    description: 'Manejo de frustración del usuario'
  },

  {
    id: 'ambiguous_request',
    category: 'edge_case',
    userGoal: 'Hacer consulta ambigua que requiere clarificación',
    userPersonality: 'confused',
    expectedFlow: ['ambiguous_query', 'ask_clarification', 'clarify', 'proceed'],
    expectedTools: [],
    expectedGuidelines: [],
    difficulty: 'medium',
    shouldSucceed: true,
    description: 'Debe pedir clarificación en lugar de asumir'
  },

  {
    id: 'follow_up_after_search',
    category: 'edge_case',
    userGoal: 'Hacer seguimiento después de una búsqueda previa',
    userPersonality: 'casual',
    expectedFlow: ['reference_previous_search', 'recall_context', 'provide_info'],
    expectedTools: [],
    expectedGuidelines: ['show_interest'],
    difficulty: 'medium',
    shouldSucceed: true,
    description: 'Debe recordar contexto de conversación anterior'
  },

  {
    id: 'price_negotiation',
    category: 'edge_case',
    userGoal: 'Intentar negociar el precio de una propiedad',
    userPersonality: 'casual',
    expectedFlow: ['ask_negotiation', 'explain_limitation', 'get_help'],
    expectedTools: ['get_help'],
    expectedGuidelines: ['get_human_help'],
    difficulty: 'medium',
    shouldSucceed: true,
    description: 'Debe escalar negociaciones al dueño'
  },

  {
    id: 'multiple_properties_comparison',
    category: 'edge_case',
    userGoal: 'Comparar características de varias propiedades',
    userPersonality: 'detailed',
    expectedFlow: ['request_comparison', 'get_properties', 'provide_comparison'],
    expectedTools: ['get_property_info'],
    expectedGuidelines: ['get_property_detail', 'show_interest'],
    difficulty: 'hard',
    shouldSucceed: true,
    description: 'Comparación detallada de múltiples propiedades'
  },

  {
    id: 'incomplete_information',
    category: 'edge_case',
    userGoal: 'Proporcionar información incompleta y esperar que el agente pregunte',
    userPersonality: 'confused',
    expectedFlow: ['partial_info', 'ask_missing_info', 'provide_info', 'proceed'],
    expectedTools: [],
    expectedGuidelines: [],
    difficulty: 'medium',
    shouldSucceed: true,
    description: 'Debe identificar información faltante y preguntar proactivamente'
  },
];

/**
 * Get scenarios by category
 */
export function getScenariosByCategory(category: ConversationScenario['category']): ConversationScenario[] {
  return syntheticScenarios.filter(s => s.category === category);
}

/**
 * Get scenarios by difficulty
 */
export function getScenariosByDifficulty(difficulty: ConversationScenario['difficulty']): ConversationScenario[] {
  return syntheticScenarios.filter(s => s.difficulty === difficulty);
}

/**
 * Get random scenarios
 */
export function getRandomScenarios(count: number): ConversationScenario[] {
  const shuffled = [...syntheticScenarios].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Get balanced scenarios (mix of categories and difficulties)
 */
export function getBalancedScenarios(count: number): ConversationScenario[] {
  const categories = ['search', 'visit_scheduling', 'owner_escalation', 'visit_management', 'edge_case'] as const;
  const perCategory = Math.floor(count / categories.length);
  const scenarios: ConversationScenario[] = [];

  for (const category of categories) {
    const categoryScenarios = getScenariosByCategory(category);
    const shuffled = categoryScenarios.sort(() => Math.random() - 0.5);
    scenarios.push(...shuffled.slice(0, perCategory));
  }

  // Fill remaining slots with random scenarios
  const remaining = count - scenarios.length;
  if (remaining > 0) {
    const unusedScenarios = syntheticScenarios.filter(s => !scenarios.includes(s));
    const shuffled = unusedScenarios.sort(() => Math.random() - 0.5);
    scenarios.push(...shuffled.slice(0, remaining));
  }

  return scenarios;
}
