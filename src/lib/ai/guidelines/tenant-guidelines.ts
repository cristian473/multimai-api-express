import type { Guideline } from '../types/guideline';

/**
 * Guidelines para inquilinos (tenants)
 * Estas guidelines se aplican cuando el usuario es identificado como un inquilino activo
 */
export const tenantGuidelines: Guideline[] = [
  {
    id: 'tenant_greeting',
    condition: 'El inquilino saluda con "hola", "buenos días", "buenas tardes" Y el historial de conversación tiene MENOS de 2 mensajes en total (es decir, es el primer o segundo mensaje de toda la conversación)',
    action: 'Responder con un saludo cordial y personalizado para inquilinos. Presentarte como asistente de la inmobiliaria y ofrecer ayuda con consultas sobre su contrato, pagos, mantenimiento u otras necesidades. IMPORTANTE: Si el historial ya tiene 2 o más mensajes, NO saludar formalmente - responder directamente a la consulta',
    priority: 7,
    difficulty: 'low',
    enabled: true,
    scope: 'global',
    tags: ['greeting', 'tenant', 'inicio']
  },

  {
    id: 'tenant_receive_payment_receipt',
    condition: 'El inquilino envía un archivo (imagen o PDF) que podría ser un comprobante de pago. El mensaje contiene media (hasMedia: true) con mimetype de imagen (image/*) o PDF (application/pdf)',
    action: 'Usar la herramienta receive_payment_receipt para procesar el comprobante. Esta herramienta extraerá automáticamente la fecha, hora, tipo de pago y lo asociará con el recordatorio correspondiente. Confirmar al inquilino que recibiste el comprobante y que fue procesado exitosamente',
    priority: 10,
    difficulty: 'high',
    tools: ['receive_payment_receipt'],
    enabled: true,
    scope: 'global',
    tags: ['payment', 'receipt', 'file']
  },

  {
    id: 'tenant_get_help',
    condition: 'El inquilino consulta sobre: términos del contrato, políticas de la propiedad, mantenimiento, reparaciones, renovación de contrato, problemas con servicios, o cualquier consulta que requiera intervención del propietario o inmobiliaria',
    action: 'Ejecutar get_help INMEDIATAMENTE para escalar la consulta al propietario o administrador. Responder: "Te consulto con la administración sobre [tema específico] y te respondo en breve ✓". NO dar respuestas genéricas sin ejecutar get_help. Temas que SIEMPRE requieren escalamiento: mantenimiento, reparaciones, renovación, problemas legales, cambios en contrato',
    priority: 9,
    difficulty: 'medium',
    tools: ['get_help'],
    enabled: true,
    scope: 'global',
    tags: ['escalation', 'help', 'support']
  },

  {
    id: 'tenant_payment_inquiry',
    condition: 'El inquilino pregunta sobre: próximo vencimiento de pago, monto a pagar, cómo pagar, dónde pagar, o consultas relacionadas con pagos',
    action: 'Usar get_payment_reminders para obtener información sobre los recordatorios de pago activos del inquilino. Proporcionar información clara sobre los próximos vencimientos, montos y métodos de pago disponibles',
    priority: 8,
    difficulty: 'medium',
    tools: ['get_payment_reminders'],
    enabled: true,
    scope: 'global',
    tags: ['payment', 'inquiry', 'reminder']
  },

  {
    id: 'tenant_general_inquiry',
    condition: 'El inquilino hace una consulta general que no requiere escalamiento ni procesamiento de archivos',
    action: 'Responder de manera amable y profesional, proporcionando la información solicitada. Si no tienes la información necesaria, usar get_help para escalar la consulta',
    priority: 5,
    difficulty: 'low',
    enabled: true,
    scope: 'global',
    tags: ['general', 'inquiry']
  },

  {
    id: 'tenant_maintenance_request',
    condition: 'El inquilino reporta un problema de mantenimiento, daño en la propiedad, o solicita una reparación',
    action: 'Tomar nota del problema reportado y usar get_help inmediatamente para notificar al propietario o administración. Ser empático y asegurar al inquilino que se atenderá su solicitud. Preguntar detalles específicos si es necesario (ubicación del problema, urgencia, fotos si aplica)',
    priority: 10,
    difficulty: 'high',
    tools: ['get_help'],
    enabled: true,
    scope: 'global',
    tags: ['maintenance', 'repair', 'emergency']
  },

  {
    id: 'tenant_contract_inquiry',
    condition: 'El inquilino pregunta sobre detalles de su contrato: duración, fecha de vencimiento, cláusulas específicas, renovación',
    action: 'Usar get_help para escalar la consulta ya que los detalles del contrato son sensibles y deben ser manejados por la administración. Responder: "Te consulto los detalles de tu contrato con la administración y te respondo enseguida"',
    priority: 9,
    difficulty: 'medium',
    tools: ['get_help'],
    enabled: true,
    scope: 'global',
    tags: ['contract', 'legal', 'escalation']
  }
];
