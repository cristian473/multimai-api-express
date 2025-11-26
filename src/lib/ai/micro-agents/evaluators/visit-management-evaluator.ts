import { generateText } from 'ai';
import type { MicroAgentEvaluationResult, MicroAgentExecutionContext } from '../../types/micro-agent-types';
import { getModel } from '../../openrouter';
import { AI_CONFIG } from '../../config';

/**
 * Evaluator for visit management micro-agent responses
 * Validates that visit scheduling/management is handled correctly
 */
export class VisitManagementEvaluator {
  private threshold: number;

  constructor(threshold: number = 7.0) {
    this.threshold = threshold;
  }

  async evaluate(
    response: string,
    context: MicroAgentExecutionContext,
    toolsExecuted: string[]
  ): Promise<MicroAgentEvaluationResult> {
    console.log('[VisitManagementEvaluator] Evaluating response...');

    // Build validation prompt
    const validationPrompt = this.buildValidationPrompt(response, context, toolsExecuted);

    // Call LLM evaluator
    const model = getModel(AI_CONFIG?.CRITIQUE_MODEL ?? 'openai/gpt-4o-mini');

    const result = await generateText({
      model,
      system: validationPrompt,
      prompt: 'Evalúa la respuesta y devuelve el resultado en formato JSON.',
      maxOutputTokens: 1000,
      temperature: 0.3
    });

    // Parse evaluation result
    const evaluationResult = this.parseEvaluationResult(result.text);

    console.log('[VisitManagementEvaluator] Score:', evaluationResult.score);
    console.log('[VisitManagementEvaluator] Valid:', evaluationResult.isValid);

    return evaluationResult;
  }

  private buildValidationPrompt(
    response: string,
    context: MicroAgentExecutionContext,
    toolsExecuted: string[]
  ): string {
    let prompt = `<validation_prompt>\n\n`;

    prompt += `  <role>\n`;
    prompt += `    <descripcion>Eres un evaluador especializado en validar respuestas sobre gestión de visitas a propiedades</descripcion>\n`;
    prompt += `    <objetivo>Evaluar que el agente maneje correctamente el agendamiento, cancelación y reprogramación de visitas</objetivo>\n`;
    prompt += `  </role>\n\n`;

    prompt += `  <mensaje_usuario>\n`;
    prompt += `    <contenido>${context.userMessage}</contenido>\n`;
    prompt += `  </mensaje_usuario>\n\n`;

    prompt += `  <respuesta_generada>\n`;
    prompt += `    <contenido>${response}</contenido>\n`;
    prompt += `  </respuesta_generada>\n\n`;

    prompt += `  <herramientas_ejecutadas>\n`;
    if (toolsExecuted.length > 0) {
      toolsExecuted.forEach(tool => {
        prompt += `    <herramienta>${tool}</herramienta>\n`;
      });
    } else {
      prompt += `    <ninguna>No se ejecutaron herramientas</ninguna>\n`;
    }
    prompt += `  </herramientas_ejecutadas>\n\n`;

    // Get validation criteria from active guidelines
    const relevantGuidelines = context.activeGuidelines.filter(g => 
      ['check_visit_availability', 'schedule_new_visit', 'cancel_visit', 'reschedule_visit'].includes(g.guideline.id)
    );

    prompt += `  <criterios_validacion>\n`;
    
    // Add criteria from guidelines
    relevantGuidelines.forEach(match => {
      const guideline = match.guideline;
      if (guideline.validationCriteria) {
        guideline.validationCriteria.forEach(criterion => {
          prompt += `    <criterio peso="${criterion.weight}">\n`;
          prompt += `      <nombre>${criterion.name}</nombre>\n`;
          prompt += `      <descripcion>${criterion.description}</descripcion>\n`;
          if (criterion.examples) {
            prompt += `      <ejemplos>\n`;
            criterion.examples.forEach(example => {
              prompt += `        <ejemplo>${example}</ejemplo>\n`;
            });
            prompt += `      </ejemplos>\n`;
          }
          prompt += `    </criterio>\n`;
        });
      }
    });

    // Add standard criteria for visit management
    prompt += `    <criterio peso="25">\n`;
    prompt += `      <nombre>Validación de datos completos</nombre>\n`;
    prompt += `      <descripcion>Para agendar una visita, se DEBEN tener: 1) property_id, 2) fecha exacta, 3) hora exacta. Si falta alguno, DEBE preguntarse explícitamente</descripcion>\n`;
    prompt += `    </criterio>\n`;

    prompt += `    <criterio peso="20">\n`;
    prompt += `      <nombre>Ejecución de herramientas apropiadas</nombre>\n`;
    prompt += `      <descripcion>Debe ejecutarse la herramienta correcta según el caso: get_availability para verificar, create_visit/add_visitor para agendar, cancel_visit para cancelar, reschedule_visit para reprogramar</descripcion>\n`;
    prompt += `    </criterio>\n`;

    prompt += `    <criterio peso="15">\n`;
    prompt += `      <nombre>Comunicación clara al usuario</nombre>\n`;
    prompt += `      <descripcion>El usuario debe recibir confirmación clara de la acción realizada (visita agendada, cancelada, etc.) con todos los detalles pertinentes</descripcion>\n`;
    prompt += `    </criterio>\n`;

    prompt += `  </criterios_validacion>\n\n`;

    prompt += `  <reglas_criticas>\n`;
    prompt += `    <regla>NO se debe agendar una visita sin tener property_id, fecha Y hora</regla>\n`;
    prompt += `    <regla>Si el usuario dice "quiero agendar una visita" sin especificar propiedad, DEBE preguntarse cuál propiedad</regla>\n`;
    prompt += `    <regla>Si el usuario dice "quiero agendar una visita" sin especificar fecha/hora, DEBE preguntarse la fecha y hora</regla>\n`;
    prompt += `    <regla>Para reprogramar, primero se debe cancelar la visita existente Y LUEGO agendar nueva</regla>\n`;
    prompt += `  </reglas_criticas>\n\n`;

    prompt += `  <instrucciones_evaluacion>\n`;
    prompt += `    <instruccion>Evalúa la respuesta en escala 0-10 basándote en los criterios de validación</instruccion>\n`;
    prompt += `    <instruccion>Considera los pesos de cada criterio para el score final</instruccion>\n`;
    prompt += `    <instruccion>Verifica que se cumplan TODAS las reglas críticas</instruccion>\n`;
    prompt += `    <instruccion>Si se viola una regla crítica, el score DEBE ser menor a ${this.threshold}</instruccion>\n`;
    prompt += `    <instruccion>Identifica problemas específicos si el score es bajo</instruccion>\n`;
    prompt += `    <instruccion>Proporciona sugerencias concretas de mejora</instruccion>\n`;
    prompt += `    <instruccion>El umbral mínimo para aprobar es ${this.threshold}/10</instruccion>\n`;
    prompt += `  </instrucciones_evaluacion>\n\n`;

    prompt += `  <formato_respuesta>\n`;
    prompt += `    <descripcion>Responde SOLO con un JSON válido en el siguiente formato:</descripcion>\n`;
    prompt += `    <json_schema>\n`;
    prompt += `{\n`;
    prompt += `  "score": 8.5,\n`;
    prompt += `  "feedback": "La respuesta es buena pero...",\n`;
    prompt += `  "issues": ["Problema 1", "Problema 2"],\n`;
    prompt += `  "suggestions": ["Sugerencia 1", "Sugerencia 2"]\n`;
    prompt += `}\n`;
    prompt += `    </json_schema>\n`;
    prompt += `  </formato_respuesta>\n\n`;

    prompt += `</validation_prompt>`;

    return prompt;
  }

  private parseEvaluationResult(resultText: string): MicroAgentEvaluationResult {
    try {
      // Extract JSON from markdown code blocks if present
      let jsonText = resultText.trim();
      
      const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonText);

      const score = Number(parsed.score) || 0;
      const isValid = score >= this.threshold;

      return {
        score,
        isValid,
        feedback: parsed.feedback || '',
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        shouldRetry: !isValid && parsed.issues && parsed.issues.length > 0
      };

    } catch (error) {
      console.error('[VisitManagementEvaluator] Error parsing evaluation result:', error);
      console.error('[VisitManagementEvaluator] Raw result:', resultText);
      
      // Return a default low score on parse error
      return {
        score: 3.0,
        isValid: false,
        feedback: 'Error al parsear resultado de evaluación',
        issues: ['No se pudo interpretar el resultado del evaluador'],
        suggestions: ['Verificar formato de respuesta del evaluador'],
        shouldRetry: false
      };
    }
  }
}
