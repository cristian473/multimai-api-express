import type { Guideline } from '../types/guideline';

/**
 * Guidelines for the Multimai real estate agent
 * Migrated from Python/Parlant implementation
 */
export const multimaiGuidelines: Guideline[] = [
  {
    id: 'greeting',
    condition: 'El usuario saluda con "hola", "buenos días", "buenas tardes" Y el historial de conversación tiene MENOS de 2 mensajes en total (es decir, es el primer o segundo mensaje de toda la conversación)',
    action: 'Responder con un saludo breve y cordial. Presentarte como asistente de inmobiliaria y preguntar cómo puedes ayudar. IMPORTANTE: Si el historial ya tiene 2 o más mensajes, NO saludar formalmente - responder directamente a la consulta del usuario sin presentación',
    priority: 6,
    difficulty: 'low',
    enabled: true,
    scope: 'global',
    tags: ['greeting', 'inicio']
  },
  
  {
    id: 'search_properties',
    condition: 'El usuario busca propiedades con criterios específicos como ubicación, precio, tipo, dormitorios, etc. O usa verbos como "busco", "quiero", "necesito", "me interesa" seguido de tipo de propiedad (casa, departamento, terreno, etc.)',
    action: 'Usa search_properties con TODOS los filtros que el usuario mencionó (precio, tipo, dormitorios, ubicación). Si no encuentra resultados en el primer intento, informa al usuario que no hay propiedades exactas pero puedes mostrar opciones similares. Muestra las propiedades encontradas con formato claro incluyendo el @@property_id: XXX@@ para referencia futura y SIEMPRE las imágenes en formato Markdown',
    priority: 8,
    difficulty: 'medium',
    tools: ['search_properties'],
    enabled: true,
    scope: 'global',
    tags: ['search', 'properties'],
    validationCriteria: [
      {
        name: 'Formato de imágenes',
        description: 'Verificar que TODAS las imágenes de propiedades estén incluidas en formato Markdown correcto: ![descripción](url). Las URLs deben ser válidas y completas de Firebase Storage (https://firebasestorage.googleapis.com/...)',
        weight: 20,
        examples: [
          'CORRECTO: ![Departamento en Palermo](https://firebasestorage.googleapis.com/v0/b/...)',
          'INCORRECTO: No incluir la imagen o usar texto plano con la URL'
        ]
      },
      {
        name: 'Formato de property_id',
        description: 'Verificar que cada propiedad mostrada incluya el identificador en formato @@property_id: XXX@@ para referencia futura',
        weight: 15,
        examples: [
          'CORRECTO: @@property_id: prop_12345@@',
          'INCORRECTO: Omitir el property_id o usar otro formato'
        ]
      },
      {
        name: 'Descripción completa de propiedades',
        description: 'Cada propiedad debe incluir: precio, ubicación, tipo, dormitorios (si aplica), y características principales del resultado de búsqueda',
        weight: 15,
        examples: [
          'CORRECTO: Departamento 2 amb en Palermo - $180,000 USD - 45m² - Balcón',
          'INCORRECTO: Solo mencionar la dirección sin detalles'
        ]
      }
    ]
  },
  
  {
    id: 'get_property_detail',
    condition: 'El usuario pregunta sobre una propiedad específica ya mostrada (identificada por @@property_id: XXX@@)',
    action: 'Usa get_property_info para obtener información detallada de esa propiedad específica',
    priority: 8,
    difficulty: 'medium',
    tools: ['get_property_info'],
    enabled: true,
    scope: 'global',
    tags: ['property', 'detail']
  },
  
  {
    id: 'show_photos',
    condition: 'El usuario solicita explícitamente ver fotos, imágenes o galería de una propiedad específica',
    action: 'Identifica la propiedad en el contexto (o pregunta si no es clara) y usa get_property_info para obtener las imágenes. Muestra las fotos usando formato Markdown ![caption](url).',
    priority: 8,
    difficulty: 'medium',
    tools: ['get_property_info'],
    enabled: true,
    scope: 'global',
    tags: ['photos', 'property', 'images'],
    validationCriteria: [
      {
        name: 'Visualización de imágenes',
        description: 'La respuesta DEBE incluir las imágenes devueltas por la herramienta en formato Markdown válido (![...caption](...firebase storage url))',
        weight: 30
      }
    ]
  },
  
  // ========== VISITAS: Guidelines específicas ordenadas por flujo ==========
  
  {
    id: 'query_visit_availability_only',
    condition: 'El usuario pregunta "¿cuándo puedo visitar?", "¿qué horarios tienen?", "¿hay disponibilidad?", "¿cuándo se puede ver?" SIN mencionar una fecha/hora específica y SIN usar verbos como "agendar", "reservar", "programar"',
    action: 'SOLO usa get_availability para mostrar los horarios disponibles. NO ejecutes create_visit ni add_visitor. Presenta los slots como opciones: "Tenemos visitas programadas para: [fechas/horarios]. ¿Te gustaría anotarte en alguna de estas?". Si no hay slots, pregunta: "¿Qué día y horario te vendría bien? Consulto al dueño la disponibilidad"',
    priority: 9,
    difficulty: 'medium',
    tools: ['get_availability'],
    enabled: true,
    scope: 'global',
    tags: ['visit', 'availability', 'query'],
    validationCriteria: [
      {
        name: 'Solo consulta, no agenda',
        description: 'Esta guideline SOLO debe mostrar disponibilidad. NO debe ejecutar create_visit ni add_visitor',
        weight: 40,
        examples: [
          'CORRECTO: "Hay visitas programadas para el sábado 15 a las 10:00 y 14:00. ¿Te anoto en alguna?"',
          'INCORRECTO: Crear una visita automáticamente sin que el usuario lo pidiera'
        ]
      }
    ]
  },

  {
    id: 'collect_visit_details_missing_property',
    condition: 'El usuario quiere "agendar", "programar", "reservar" una visita PERO NO se identifica claramente qué propiedad quiere visitar (no hay @@property_id@@ en contexto reciente o no especificó cuál)',
    action: 'NO ejecutar ninguna herramienta de visita. Preguntar: "¿Cuál de las propiedades te gustaría visitar?" Si no se mostraron propiedades antes, usar search_properties primero para que el usuario elija',
    priority: 11,
    difficulty: 'medium',
    tools: ['search_properties'],
    enabled: true,
    scope: 'global',
    tags: ['visit', 'scheduling', 'validation'],
    validationCriteria: [
      {
        name: 'Solicitar propiedad antes de continuar',
        description: 'NO se debe intentar agendar sin saber qué propiedad visitar',
        weight: 30,
        examples: [
          'CORRECTO: "¿Cuál de las propiedades te gustaría visitar?"',
          'INCORRECTO: Ejecutar create_visit sin property_id'
        ]
      }
    ]
  },

  {
    id: 'collect_visit_details_missing_datetime',
    condition: 'El usuario quiere "agendar", "programar", "reservar" una visita Y se identifica la propiedad (@@property_id@@ en contexto) PERO NO especificó fecha Y hora concretas',
    action: 'NO ejecutar create_visit todavía. Usar get_availability para mostrar slots existentes. Preguntar: "¿Qué día y horario te vendría bien?" o "Tenemos estas visitas programadas: [slots]. ¿Te anoto en alguna o preferís otro horario?"',
    priority: 10,
    difficulty: 'medium',
    tools: ['get_availability'],
    enabled: true,
    scope: 'global',
    tags: ['visit', 'scheduling', 'validation'],
    validationCriteria: [
      {
        name: 'Solicitar fecha/hora antes de crear',
        description: 'NO se debe crear visita sin fecha Y hora específicas del cliente',
        weight: 30,
        examples: [
          'CORRECTO: "¿Qué día y horario te vendría bien para visitarla?"',
          'INCORRECTO: Ejecutar create_visit sin fecha/hora'
        ]
      }
    ]
  },

  {
    id: 'schedule_visit_join_existing_slot',
    condition: 'El usuario quiere agendar visita Y tengo property_id Y tengo fecha/hora específica Y get_availability devolvió un slot existente que coincide con esa fecha/hora',
    action: 'Usar add_visitor para agregar al cliente al slot de visita existente. Confirmar: "Te anoté en la visita del [fecha] a las [hora] en [dirección]. ¡Te esperamos!"',
    priority: 10,
    difficulty: 'high',
    tools: ['add_visitor'],
    enabled: true,
    scope: 'global',
    tags: ['visit', 'scheduling', 'existing_slot'],
    validationCriteria: [
      {
        name: 'Usar slot existente',
        description: 'Si hay un slot que coincide, usar add_visitor en vez de create_visit',
        weight: 25,
        examples: [
          'CORRECTO: Usar add_visitor para sumar al cliente a visita existente',
          'INCORRECTO: Crear visita duplicada con create_visit'
        ]
      },
      {
        name: 'Confirmación completa',
        description: 'Confirmar fecha, hora y dirección al cliente',
        weight: 20,
        examples: [
          'CORRECTO: "Te anoté para el sábado 15 a las 14:00 en Av. Santa Fe 1234"',
          'INCORRECTO: Solo decir "Listo"'
        ]
      }
    ]
  },

  {
    id: 'schedule_visit_request_new_slot',
    condition: 'El usuario quiere agendar visita Y tengo property_id Y tengo fecha/hora específica Y get_availability NO devolvió slots existentes para esa fecha/hora (o devolvió vacío)',
    action: 'NO ejecutar create_visit directamente. PRIMERO usar ask_availability para consultar al dueño si está disponible en esa fecha/hora. Responder: "Te consulto con el dueño la disponibilidad para el [fecha] a las [hora] y te confirmo enseguida ✓". Esperar respuesta del dueño antes de crear la visita',
    priority: 10,
    difficulty: 'high',
    tools: ['ask_availability'],
    enabled: true,
    scope: 'global',
    tags: ['visit', 'scheduling', 'new_slot', 'owner_confirmation'],
    validationCriteria: [
      {
        name: 'Consultar al dueño primero',
        description: 'SIEMPRE consultar al dueño antes de crear una visita nueva. NO crear visita sin confirmación del propietario',
        weight: 40,
        examples: [
          'CORRECTO: "Te consulto con el dueño la disponibilidad para el martes a las 15:00 y te confirmo ✓"',
          'INCORRECTO: Ejecutar create_visit sin consultar al dueño'
        ]
      },
      {
        name: 'No prometer sin confirmación',
        description: 'NO decir "agendé tu visita" hasta que el dueño confirme',
        weight: 25,
        examples: [
          'CORRECTO: "Te aviso apenas el dueño me confirme"',
          'INCORRECTO: "Perfecto, agendé tu visita" (sin confirmación del dueño)'
        ]
      }
    ]
  },

  {
    id: 'notify_user_owner_confirmed_availability',
    condition: 'El dueño/propietario ACABA DE confirmar disponibilidad para una visita (respuesta afirmativa a ask_availability) Y el USUARIO todavía NO confirmó que quiere esa fecha/hora',
    action: 'NO ejecutar create_visit todavía. Informar al usuario que el dueño confirmó disponibilidad y PEDIR CONFIRMACIÓN: "¡Buenas noticias! El dueño confirmó disponibilidad para el [fecha] a las [hora]. ¿Te anoto para esa visita?" Esperar respuesta afirmativa del usuario antes de crear',
    priority: 11,
    difficulty: 'medium',
    enabled: true,
    scope: 'global',
    tags: ['visit', 'scheduling', 'user_confirmation'],
    validationCriteria: [
      {
        name: 'Pedir confirmación al usuario',
        description: 'SIEMPRE pedir confirmación explícita del usuario antes de crear la visita',
        weight: 40,
        examples: [
          'CORRECTO: "El dueño confirmó para el martes a las 15:00. ¿Te anoto?"',
          'INCORRECTO: Crear la visita automáticamente sin preguntar al usuario'
        ]
      },
      {
        name: 'No crear sin respuesta del usuario',
        description: 'Esperar a que el usuario diga "sí", "dale", "perfecto", etc.',
        weight: 30,
        examples: [
          'CORRECTO: Esperar respuesta afirmativa del usuario',
          'INCORRECTO: Asumir que el usuario quiere la visita y crearla'
        ]
      }
    ]
  },

  {
    id: 'create_visit_after_both_confirmations',
    condition: 'El dueño confirmó disponibilidad Y el usuario ACABA DE confirmar que quiere la visita (dijo "sí", "dale", "perfecto", "ok", "confirmo", etc.) Y tengo property_id Y fecha/hora',
    action: 'Ahora sí ejecutar create_visit con los datos confirmados. Confirmar al cliente: "¡Listo! Agendé tu visita para el [fecha] a las [hora] en [dirección]. Te llegará una confirmación por WhatsApp"',
    priority: 12,
    difficulty: 'high',
    tools: ['create_visit'],
    enabled: true,
    scope: 'global',
    tags: ['visit', 'scheduling', 'confirmed', 'final'],
    validationCriteria: [
      {
        name: 'Solo crear con ambas confirmaciones',
        description: 'create_visit solo se ejecuta DESPUÉS de que el dueño Y el usuario confirmaron',
        weight: 40,
        examples: [
          'CORRECTO: Dueño confirmó + Usuario dijo "sí" → create_visit',
          'INCORRECTO: Crear visita solo con confirmación del dueño'
        ]
      },
      {
        name: 'Confirmación completa al usuario',
        description: 'Informar fecha, hora y dirección de la visita creada',
        weight: 25,
        examples: [
          'CORRECTO: "Agendé tu visita para el sábado 15 a las 14:00 en Av. Santa Fe 1234"',
          'INCORRECTO: Solo decir "Listo" sin detalles'
        ]
      }
    ]
  },

  {
    id: 'user_declines_after_owner_confirmation',
    condition: 'El dueño confirmó disponibilidad PERO el usuario rechazó o quiere otro horario (dijo "no", "mejor otro día", "no me sirve", "prefiero otro horario")',
    action: 'NO crear visita. Preguntar qué otro día/horario prefiere: "Entendido, no hay problema. ¿Qué otro día y horario te vendría mejor?" y volver al flujo de consultar disponibilidad',
    priority: 11,
    difficulty: 'medium',
    enabled: true,
    scope: 'global',
    tags: ['visit', 'scheduling', 'decline', 'reschedule'],
    validationCriteria: [
      {
        name: 'Respetar decisión del usuario',
        description: 'Si el usuario no quiere ese horario, NO crear la visita',
        weight: 35,
        examples: [
          'CORRECTO: "¿Qué otro día te vendría mejor?"',
          'INCORRECTO: Crear la visita de todas formas'
        ]
      }
    ]
  },
  
  {
    id: 'get_human_help',
    condition: 'El usuario pregunta sobre: política de mascotas, negociación de precios, condiciones especiales, requisitos de contrato, modificaciones a la propiedad, O dice explícitamente "pregunta/contacta/habla con el dueño/propietario"',
    action: 'Ejecutar get_help INMEDIATAMENTE sin dar respuestas genéricas primero. Responder al usuario: "Te consulto al dueño sobre [tema específico] y te aviso en breve ✓". NO decir "no tengo información" sin ejecutar get_help. Temas que SIEMPRE requieren escalamiento: mascotas, negociación precio, políticas de alquiler/venta no especificadas, modificaciones, garantías especiales',
    priority: 10,
    difficulty: 'high',
    tools: ['get_help'],
    enabled: true,
    scope: 'global',
    tags: ['escalation', 'help']
  },
  
  {
    id: 'show_interest',
    condition: 'El usuario muestra interés en una propiedad',
    action: 'Proporciona información completa y ofrece proactivamente programar una visita',
    priority: 8,
    difficulty: 'medium',
    enabled: true,
    scope: 'global',
    tags: ['engagement', 'property'],
    tools: ['search_properties']
  },
  {
    id: 'handle_selling_inquiry',
    condition: 'El usuario pregunta sobre vender o listar una propiedad propia',
    action: 'Pregunta por detalles básicos de la propiedad (ubicación, tipo, precio estimado) y ofrece conectar con un agente humano para una evaluación o usa una herramienta para estimar valor si está disponible',
    priority: 8,
    difficulty: 'high',
    tools: ['get_help'], // O una herramienta nueva como 'estimate_property_value' si se implementa
    enabled: true,
    scope: 'global',
    tags: ['selling', 'listing']
  },
  {
    id: 'collect_feedback',
    condition: 'La interacción ha concluido (e.g., después de una búsqueda o visita programada) o el usuario menciona una experiencia pasada',
    action: 'Pregunta cortésmente por feedback sobre la interacción o la propiedad, y registra la respuesta para el agente humano si aplica',
    priority: 6,
    difficulty: 'low',
    tools: ['log_feedback'],
    enabled: true,
    scope: 'global',
    tags: ['feedback', 'followup'],
    validationCriteria: [
      {
        name: 'Feedback',
        description: 'Verificar que la conversación terminó para pedir feedback',
        weight: 10,
        examples: [
          'CORRECTO: "Podrias calificar tu experiencia de atención al cliente con una nota de 1 a 5?"',
        ]
      }
    ]
  },
  
  {
    id: 'cancel_visit',
    condition: 'El usuario quiere cancelar una visita programada',
    action: 'Confirma el deseo de cancelar, busca al visitante en las visitas de la propiedad usando cancel_visit. Ofrece ayuda adicional después de confirmar la cancelación',
    priority: 8,
    difficulty: 'high',
    tools: ['cancel_visit'],
    enabled: true,
    scope: 'global',
    tags: ['visit', 'cancellation']
  },
  
  {
    id: 'reschedule_visit',
    condition: 'El usuario quiere reprogramar o cambiar el horario de una visita existente',
    action: 'Usa reschedule_visit para buscar y cancelar la visita existente del cliente, luego pregunta por la nueva fecha/horario deseada y procede con el flujo normal de agendar visita (get_availability -> create_visit/add_visitor)',
    priority: 8,
    difficulty: 'high',
    tools: ['reschedule_visit', 'get_availability', 'create_visit', 'add_visitor'],
    enabled: true,
    scope: 'global',
    tags: ['visit', 'rescheduling'],
    validationCriteria: [
      {
        name: 'No reprogramar sin confirmar con el dueño por el cambio de fecha/horario en caso que no haya disponibilidad',
        description: 'Verificar que la respuesta confirme haber consultado con el dueño por el cambio de fecha/horario en caso que no haya disponibilidad',
        weight: 30,
        examples: [
          'CORRECTO: "Consulté al dueño sobre el cambio de fecha/horario y te aviso en breve ✓"',
          'INCORRECTO: Responder solo "Listo" sin detalles de la consulta con el dueño'
        ]
      },
      {
        name: 'Confirmación de reprogramación',
        description: 'Verificar que la respuesta confirme tener: 1) property_id específico, 2) fecha exacta, 3) hora exacta. Si falta alguno, debe preguntar explícitamente por el dato faltante',
        weight: 25,
        examples: [
          'CORRECTO: "¿Cuál de las propiedades te gustaría visitar?" (cuando falta property_id)',
          'INCORRECTO: Intentar agendar sin tener todos los datos necesarios'
        ]
      },
      {
        name: 'Confirmación de cancelación',
        description: 'Verificar que la respuesta confirme haber cancelado la visita existente',
        weight: 20,
        examples: [
          'CORRECTO: "Cancelé la visita existente para el 15/05 a las 14:00 en Av. Santa Fe 1234. Te llegará una confirmación por WhatsApp."',
          'INCORRECTO: Responder solo "Listo" sin detalles de la cancelación'
        ]
      }
    ]
  },
  
  {
    id: 'check_visit_status',
    condition: 'El usuario pregunta por el estado de una visita programada, si está activa, cancelada, o quiere saber detalles como fecha, hora, dirección, usando el visit_id o haciendo referencia a una visita específica',
    action: 'Usa get_visit_status con el visit_id para obtener toda la información de la visita: estado (activa/cancelada), fecha, hora, dirección de la propiedad, notas y visitantes. Si el usuario no proporciona el visit_id, pídelo o búscalo en el contexto de la conversación',
    priority: 8,
    difficulty: 'medium',
    tools: ['get_visit_status'],
    enabled: true,
    scope: 'global',
    tags: ['visit', 'status', 'query'],
    validationCriteria: [
      {
        name: 'Confirmación de datos de visita',
        description: 'La respuesta debe incluir claramente: estado de la visita (activa/cancelada), fecha, hora, y dirección de la propiedad',
        weight: 25,
        examples: [
          'CORRECTO: "Tu visita está ACTIVA para el viernes 15 de noviembre a las 14:00 en Av. Santa Fe 1234."',
          'INCORRECTO: "La visita está activa" (sin detalles de cuándo y dónde)'
        ]
      },
      {
        name: 'Manejo de visita cancelada',
        description: 'Si la visita está cancelada, informar claramente y ofrecer reprogramar',
        weight: 20,
        examples: [
          'CORRECTO: "Tu visita fue CANCELADA. ¿Te gustaría reprogramarla para otro día?"',
          'INCORRECTO: "La visita no está disponible" (ambiguo)'
        ]
      }
    ]
  },
  
  {
    id: 'property_reference_context',
    condition: 'El usuario se refiere a una propiedad usando "la primera", "la segunda", "esa propiedad", "la del precio X" después de que se mostraron propiedades',
    action: 'Buscar en el historial reciente las propiedades mostradas con @@property_id: XXX@@. Identificar cuál propiedad menciona el usuario basándose en el contexto (primera=primera en la lista, precio=propiedad con ese precio, etc.). Usar ese property_id para consultas subsiguientes',
    priority: 9,
    difficulty: 'medium',
    enabled: true,
    scope: 'global',
    tags: ['context', 'properties', 'reference']
  },

  {
    id: 'no_results_fallback',
    condition: 'Después de usar search_properties y NO encontrar resultados que coincidan exactamente con los criterios del usuario',
    action: 'Informar honestamente: "No encontré propiedades que cumplan exactamente con [criterios]. Sin embargo, puedo mostrarte opciones similares si relajamos [criterio específico]". NO decir genéricamente "no tengo propiedades". Ofrecer alternativas concretas o preguntar si quiere ampliar la búsqueda',
    priority: 7,
    difficulty: 'low',
    enabled: true,
    scope: 'global',
    tags: ['search', 'fallback', 'ux']
  },

  // visit_intent_without_details moved to: collect_visit_details_missing_property and collect_visit_details_missing_datetime

  {
    id: 'price_negotiation_escalation',
    condition: 'El usuario pregunta si el precio es "negociable", "flexible", o si puede "ofrecer menos", "hacer una oferta"',
    action: 'Esta es una pregunta que SIEMPRE debe escalarse al dueño. Ejecutar get_help inmediatamente con el mensaje del usuario. Responder: "Te consulto con el dueño sobre la negociación del precio y te respondo enseguida"',
    priority: 10,
    difficulty: 'low',
    tools: ['get_help'],
    enabled: true,
    scope: 'global',
    tags: ['escalation', 'price', 'negotiation']
  }
];

