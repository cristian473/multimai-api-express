import { generateText } from 'ai';
import type { MicroAgentEvaluationResult, MicroAgentExecutionContext } from '../../types/micro-agent-types';
import { getModel } from '../../openrouter';
import { AI_CONFIG } from '../../config';

/**
 * Evaluator for property search micro-agent responses
 * Validates that property information is complete and correctly formatted
 */
export class PropertySearchEvaluator {
  private threshold: number;

  constructor(threshold: number = 7.0) {
    this.threshold = threshold;
  }

  async evaluate(
    response: string,
    context: MicroAgentExecutionContext,
    toolsExecuted: string[]
  ): Promise<MicroAgentEvaluationResult> {
    console.log('[PropertySearchEvaluator] Evaluating response...');

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

    console.log('[PropertySearchEvaluator] Score:', evaluationResult.score);
    console.log('[PropertySearchEvaluator] Valid:', evaluationResult.isValid);

    return evaluationResult;
  }

  private buildValidationPrompt(
    response: string,
    context: MicroAgentExecutionContext,
    toolsExecuted: string[]
  ): string {
    let prompt = `<validation_prompt>\n\n`;

    prompt += `  <role>\n`;
    prompt += `    <descripcion>Eres un evaluador especializado en validar respuestas sobre búsqueda de propiedades</descripcion>\n`;
    prompt += `    <objetivo>Evaluar la calidad y completitud de la respuesta según criterios específicos</objetivo>\n`;
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
      ['search_properties', 'get_property_detail', 'show_interest'].includes(g.guideline.id)
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

    // Add standard criteria for property search
    prompt += `    <criterio peso="20">\n`;
    prompt += `      <nombre>Uso de herramientas</nombre>\n`;
    prompt += `      <descripcion>Si el usuario busca propiedades, DEBE ejecutarse search_properties. Si pregunta por una propiedad específica, DEBE ejecutarse get_property_info</descripcion>\n`;
    prompt += `    </criterio>\n`;

    prompt += `    <criterio peso="15">\n`;
    prompt += `      <nombre>Relevancia de la respuesta</nombre>\n`;
    prompt += `      <descripcion>La respuesta debe ser relevante al mensaje del usuario y enfocarse en propiedades</descripcion>\n`;
    prompt += `    </criterio>\n`;

    prompt += `  </criterios_validacion>\n\n`;

    prompt += `  <instrucciones_evaluacion>\n`;
    prompt += `    <instruccion>Evalúa la respuesta en escala 0-10 basándote en los criterios de validación</instruccion>\n`;
    prompt += `    <instruccion>Considera los pesos de cada criterio para el score final</instruccion>\n`;
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
      console.error('[PropertySearchEvaluator] Error parsing evaluation result:', error);
      console.error('[PropertySearchEvaluator] Raw result:', resultText);
      
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
