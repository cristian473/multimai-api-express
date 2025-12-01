/**
 * Style Validator
 * Validates and corrects response style: tone, format, security
 * Now directly returns corrected response instead of just validating
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { getModel } from '../../openrouter';
import { AI_CONFIG } from '../../config';
import type { StyleValidationResult } from '../types';
import type { GuidelineMatch } from '../../types/guideline';

const StyleCorrectionSchema = z.object({
  correctedResponse: z.string().describe('La respuesta corregida o la original si no necesita cambios'),
  wasCorreced: z.boolean().describe('Si se hicieron correcciones'),
  score: z.number().min(0).max(10).describe('Puntuación de estilo (7+ si es aceptable)')
});

export interface StyleValidatorConfig {
  minScore: number;
  checkSecurity: boolean;
}

const DEFAULT_CONFIG: StyleValidatorConfig = {
  minScore: 7.0,
  checkSecurity: true
};

export class StyleValidator {
  private config: StyleValidatorConfig;
  private model: ReturnType<typeof getModel>;

  constructor(config: Partial<StyleValidatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.model = getModel(AI_CONFIG?.CASCADE?.STYLE_VALIDATOR_MODEL, {reasoning: {enabled: true, effort: 'medium'}});
  }

  /**
 * Validate and correct response in one step
 * Returns the corrected response directly
 */
  async validateAndCorrect(
    response: string,
    userMessage: string,
    activeGuidelines: GuidelineMatch[],
    contextVariables?: Record<string, string>
  ): Promise<{ response: string; score: number; wasCorreced: boolean }> {
    console.log('[StyleValidator] Validating and correcting...');

    // First: quick check
    const quickCheck = this.quickValidate(response);

    // Build XML system prompt with Chain of Thought
    let systemPrompt = `<style_corrector>\n\n`;

    systemPrompt += `  <rol>\n`;
    systemPrompt += `    Eres un corrector de estilo especializado en respuestas de agentes inmobiliarios.\n`;
    systemPrompt += `    Tu trabajo es revisar y, si es necesario, corregir respuestas para que cumplan con las reglas de estilo.\n`;
    systemPrompt += `  </rol>\n\n`;

    systemPrompt += `  <reglas_estilo_base>\n`;
    systemPrompt += `    1. Tono amigable y profesional, como un agente real\n`;
    systemPrompt += `    2. NO usar frases como "soy un asistente" o "como IA"\n`;
    systemPrompt += `    3. Respuestas concisas y resumidas\n`;
    systemPrompt += `    4. Formato Markdown válido para imágenes: ![desc](url)\n`;
    systemPrompt += `    5. NO exponer datos sensibles (teléfonos de dueños, direcciones exactas)\n`;
    systemPrompt += `    6. NO mostrar ids de propiedades o visitas en la respuesta\n`;
    systemPrompt += `    7. NO repetir información ya enviada en la conversación\n`;
    systemPrompt += `    8. NO agregar información adicional que no esté en la respuesta original\n`;
    systemPrompt += `    9. NO repetir mensajes que ya haya sido enviados en la conversación\n`;
    systemPrompt += `    10. NO te presentes en cada interaccion, solo cuando te saludan\n`;
    systemPrompt += `  </reglas_estilo_base>\n\n`;

    // Include active guidelines with their validation criteria
    if (activeGuidelines && activeGuidelines.length > 0) {
      systemPrompt += `  <guidelines_activas>\n`;
      systemPrompt += `    <nota>Guidelines activas para este mensaje - úsalas para validar que la respuesta cumple con las expectativas</nota>\n\n`;
      
      activeGuidelines.forEach(match => {
        const g = match.guideline;
        systemPrompt += `    <guideline id="${g.id}" score="${match.score.toFixed(2)}">\n`;
        systemPrompt += `      <condicion>${g.condition}</condicion>\n`;
        systemPrompt += `      <accion_esperada>${g.action}</accion_esperada>\n`;
        
        // Include validation criteria if available
        if (g.validationCriteria && g.validationCriteria.length > 0) {
          systemPrompt += `      <criterios_validacion>\n`;
          g.validationCriteria.forEach((v) => {
            systemPrompt += `        <criterio peso="${v.weight || 1}">\n`;
            systemPrompt += `          <nombre>${v.name}</nombre>\n`;
            systemPrompt += `          <descripcion>${v.description}</descripcion>\n`;
            if (v.examples && v.examples.length > 0) {
              systemPrompt += `          <ejemplos>${v.examples.join('; ')}</ejemplos>\n`;
            }
            systemPrompt += `        </criterio>\n`;
          });
          systemPrompt += `      </criterios_validacion>\n`;
        }
        
        // Include metadata hints if available (for response style hints)
        if (g.metadata) {
          const meta = g.metadata as Record<string, any>;
          if (meta.tone || meta.maxLength || meta.includeEmoji !== undefined || meta.format) {
            systemPrompt += `      <estilo_respuesta>\n`;
            if (meta.tone) {
              systemPrompt += `        <tono>${meta.tone}</tono>\n`;
            }
            if (meta.maxLength) {
              systemPrompt += `        <longitud_maxima>${meta.maxLength}</longitud_maxima>\n`;
            }
            if (meta.includeEmoji !== undefined) {
              systemPrompt += `        <incluir_emojis>${meta.includeEmoji}</incluir_emojis>\n`;
            }
            if (meta.format) {
              systemPrompt += `        <formato>${meta.format}</formato>\n`;
            }
            systemPrompt += `      </estilo_respuesta>\n`;
          }
        }
        
        systemPrompt += `    </guideline>\n\n`;
      });
      
      systemPrompt += `  </guidelines_activas>\n\n`;
    }

    systemPrompt += `  <contexto>\n`;
    systemPrompt += `    <mensaje_usuario>${userMessage}</mensaje_usuario>\n`;
    systemPrompt += `    <respuesta_a_revisar>\n${response}\n    </respuesta_a_revisar>\n`;
    if (quickCheck.issues.length > 0) {
      systemPrompt += `    <problemas_detectados_automaticamente>\n`;
      quickCheck.issues.forEach(issue => {
        systemPrompt += `      - ${issue}\n`;
      });
      systemPrompt += `    </problemas_detectados_automaticamente>\n`;
    }
    // Context variables from workflow (fecha, nombre_usuario, nombre_negocio, etc.)
    if (contextVariables && Object.keys(contextVariables).length > 0) {
      systemPrompt += `    <variables_contexto>\n`;
      for (const [key, value] of Object.entries(contextVariables)) {
        systemPrompt += `      <variable nombre="${key}">${value}</variable>\n`;
      }
      systemPrompt += `    </variables_contexto>\n`;
    }
    systemPrompt += `  </contexto>\n\n`;

    systemPrompt += `  <cadena_de_pensamiento>\n`;
    systemPrompt += `    Sigue estos pasos EN ORDEN para evaluar y corregir la respuesta:\n\n`;

    systemPrompt += `    <paso_1>\n`;
    systemPrompt += `      ANALIZAR TONO Y VOZ\n`;
    systemPrompt += `      - ¿La respuesta suena como un agente inmobiliario profesional?\n`;
    systemPrompt += `      - ¿Contiene frases que revelen que es una IA? (ej: "como asistente", "soy una IA", "no tengo acceso")\n`;
    systemPrompt += `      - ¿El tono es amigable pero profesional?\n`;
    systemPrompt += `      → Si encuentras problemas, anótalos para corregir.\n`;
    systemPrompt += `    </paso_1>\n\n`;

    systemPrompt += `    <paso_2>\n`;
    systemPrompt += `      REVISAR DATOS SENSIBLES\n`;
    systemPrompt += `      - ¿Aparecen teléfonos de propietarios/dueños?\n`;
    systemPrompt += `      - ¿Hay direcciones exactas expuestas?\n`;
    systemPrompt += `      - ¿Se muestran IDs de propiedades o visitas? (ej: "ID: abc123", "propiedad #456")\n`;
    systemPrompt += `      → Si encuentras datos sensibles, márcalos para eliminar.\n`;
    systemPrompt += `    </paso_2>\n\n`;

    systemPrompt += `    <paso_3>\n`;
    systemPrompt += `      VERIFICAR FORMATO\n`;
    systemPrompt += `      - ¿Las imágenes usan formato Markdown correcto? ![descripción](url)\n`;
    systemPrompt += `      - ¿La respuesta es concisa o tiene texto innecesario?\n`;
    systemPrompt += `      - ¿Hay repetición de información?\n`;
    systemPrompt += `      → Si el formato es incorrecto, anótalo para corregir.\n`;
    systemPrompt += `    </paso_3>\n\n`;

    systemPrompt += `    <paso_4>\n`;
    systemPrompt += `      EVALUAR CONTENIDO\n`;
    systemPrompt += `      - ¿La respuesta contesta adecuadamente al mensaje del usuario?\n`;
    systemPrompt += `      - ¿Toda la información presente está en la respuesta original?\n`;
    systemPrompt += `      → IMPORTANTE: NO agregues información que no exista en la respuesta original.\n`;
    systemPrompt += `    </paso_4>\n\n`;

    systemPrompt += `    <paso_5>\n`;
    systemPrompt += `      VALIDAR SEGÚN GUIDELINES ACTIVAS\n`;
    systemPrompt += `      - Revisa cada guideline activa en <guidelines_activas>\n`;
    systemPrompt += `      - ¿La respuesta cumple con la acción esperada de cada guideline?\n`;
    systemPrompt += `      - ¿Cumple con los criterios de validación definidos?\n`;
    systemPrompt += `      - ¿El estilo de respuesta coincide con lo esperado (tono, longitud, emojis)?\n`;
    systemPrompt += `      → Si hay incumplimientos, anótalos pero NO agregues información nueva.\n`;
    systemPrompt += `    </paso_5>\n\n`;

    systemPrompt += `    <paso_6>\n`;
    systemPrompt += `      DECISIÓN FINAL\n`;
    systemPrompt += `      - Si NO encontraste problemas en pasos 1-5: devuelve la respuesta TAL CUAL, sin cambios.\n`;
    systemPrompt += `      - Si SÍ encontraste problemas: corrige SOLO los problemas identificados.\n`;
    systemPrompt += `      - Asigna un score de 1-10 basado en cuántos problemas encontraste:\n`;
    systemPrompt += `        * 9-10: Sin problemas o problemas muy menores\n`;
    systemPrompt += `        * 7-8: 1-2 problemas menores corregidos\n`;
    systemPrompt += `        * 5-6: Varios problemas de estilo corregidos\n`;
    systemPrompt += `        * 3-4: Problemas significativos (datos sensibles, tono de IA, incumplimiento de guidelines)\n`;
    systemPrompt += `        * 1-2: Respuesta requirió corrección mayor\n`;
    systemPrompt += `    </paso_6>\n`;
    systemPrompt += `  </cadena_de_pensamiento>\n\n`;

    systemPrompt += `  <restricciones_criticas>\n`;
    systemPrompt += `    - NUNCA inventes propiedades, precios, características o datos que no estén en la respuesta original\n`;
    systemPrompt += `    - NUNCA agregues saludos o despedidas si no existían\n`;
    systemPrompt += `    - NUNCA cambies el significado o la información factual\n`;
    systemPrompt += `    - Si la respuesta ya es correcta, devuélvela EXACTAMENTE igual\n`;
    systemPrompt += `  </restricciones_criticas>\n\n`;

    systemPrompt += `</style_corrector>`;

    const result = await generateObject({
      model: this.model,
      schema: StyleCorrectionSchema,
      system: systemPrompt,
      prompt: 'Ejecuta la cadena de pensamiento paso a paso y devuelve el resultado.',
      temperature: 0.3
    });

    const { correctedResponse, wasCorreced, score } = result.object;

    console.log(`[StyleValidator] Score: ${score}/10, Corrected: ${wasCorreced}`);

    return {
      response: correctedResponse,
      score,
      wasCorreced
    };
  }

  /**
   * Legacy validate method - now simplified
   */
  async validate(
    response: string,
    userMessage: string,
    activeGuidelines: GuidelineMatch[]
  ): Promise<StyleValidationResult> {
    const result = await this.validateAndCorrect(response, userMessage, activeGuidelines);

    return {
      passed: result.score >= this.config.minScore,
      score: result.score,
      criteria: {
        toneCheck: true,
        markdownValid: true,
        securityCheck: true,
        lengthAppropriate: true,
        emojiUsage: 'appropriate'
      },
      feedback: result.wasCorreced ? 'Respuesta corregida' : 'Respuesta OK',
      suggestions: [],
      shouldRegenerate: false
    };
  }

  /**
   * Quick heuristic validation (no LLM call)
   * Useful for basic checks before/after LLM validation
   */
  quickValidate(response: string): { passed: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check length
    if (response.length < 10) {
      issues.push('Respuesta demasiado corta');
    }
    if (response.length > 3000) {
      issues.push('Respuesta demasiado larga');
    }

    // Check for common issues
    if (response.toLowerCase().includes('soy un asistente') ||
      response.toLowerCase().includes('como ia')) {
      issues.push('Contiene frases de "asistente virtual"');
    }

    // Check for broken markdown
    const imageMatches: string[] = response.match(/!\[.*?\]\(.*?\)/g) || [];
    const brokenImages = imageMatches.filter((img: string) =>
      !img.includes('http://') && !img.includes('https://')
    );
    if (brokenImages.length > 0) {
      issues.push('Imágenes con URLs inválidas');
    }

    // Check for excessive emojis (more than 10)
    const emojiCount = (response.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
    if (emojiCount > 10) {
      issues.push('Uso excesivo de emojis');
    }

    // Check for empty/placeholder content
    if (response.includes('[TODO]') || response.includes('[PLACEHOLDER]')) {
      issues.push('Contiene placeholders no reemplazados');
    }

    return {
      passed: issues.length === 0,
      issues
    };
  }

  /**
   * Apply style fixes to response (simple transformations)
   */
  applyQuickFixes(response: string): string {
    let fixed = response;

    // Remove excessive whitespace
    fixed = fixed.replace(/\n{3,}/g, '\n\n');

    // Fix common markdown issues
    fixed = fixed.replace(/!\[\s*\]\(/g, '![Imagen]('); // Empty alt text

    // Remove "soy un asistente" phrases
    fixed = fixed.replace(/[Ss]oy un asistente (virtual|de IA|artificial)/g, '');
    fixed = fixed.replace(/[Cc]omo (asistente|IA)/g, '');

    // Ensure proper spacing around emojis
    fixed = fixed.replace(/(\S)([\u{1F300}-\u{1F9FF}])/gu, '$1 $2');
    fixed = fixed.replace(/([\u{1F300}-\u{1F9FF}])(\S)/gu, '$1 $2');

    return fixed.trim();
  }
}

/**
 * Create a combined validation report
 */
export function createValidationReport(
  styleResult: StyleValidationResult,
  quickResult: { passed: boolean; issues: string[] }
): string {
  let report = '=== VALIDATION REPORT ===\n\n';

  report += `Style Score: ${styleResult.score}/10\n`;
  report += `Passed: ${styleResult.passed}\n\n`;

  report += 'Criteria:\n';
  report += `  - Tone: ${styleResult.criteria.toneCheck ? '✓' : '✗'}\n`;
  report += `  - Markdown: ${styleResult.criteria.markdownValid ? '✓' : '✗'}\n`;
  report += `  - Security: ${styleResult.criteria.securityCheck ? '✓' : '✗'}\n`;
  report += `  - Length: ${styleResult.criteria.lengthAppropriate ? '✓' : '✗'}\n`;
  report += `  - Emojis: ${styleResult.criteria.emojiUsage}\n\n`;

  if (quickResult.issues.length > 0) {
    report += 'Quick Check Issues:\n';
    quickResult.issues.forEach(issue => {
      report += `  - ${issue}\n`;
    });
    report += '\n';
  }

  if (styleResult.suggestions.length > 0) {
    report += 'Suggestions:\n';
    styleResult.suggestions.forEach(suggestion => {
      report += `  - ${suggestion}\n`;
    });
  }

  return report;
}

