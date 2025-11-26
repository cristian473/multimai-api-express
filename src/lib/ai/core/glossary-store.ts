import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { AI_CONFIG } from '../config';
import { getOpenRouterModel } from '../openrouter';

export class GlossaryStore {
  private terms: Map<string, string> = new Map();
  private model = getOpenRouterModel(AI_CONFIG?.GLOSSARY_MODEL ?? 'openai/gpt-4o-mini'); // Efficient model for extraction

  constructor(domainTerms: Record<string, string> = {}) {
    Object.entries(domainTerms).forEach(([term, definition]) => {
      this.terms.set(term.toLowerCase(), definition);
    });
  }

  // Add term to glossary
  addTerm(term: string, definition: string): void {
    this.terms.set(term.toLowerCase(), definition);
  }

  // Load terms in bulk
  loadTerms(terms: Record<string, string>): void {
    Object.entries(terms).forEach(([term, definition]) => {
      this.addTerm(term, definition);
    });
  }

  // Extract relevant terms from context using LLM
  async extractRelevantTerms(
    userMessage: string,
    maxTerms: number = 5
  ): Promise<string[]> {
    const availableTerms = Array.from(this.terms.keys());
    
    if (availableTerms.length === 0) return [];

    try {
      const { object } = await generateObject({
        model: this.model,
        schema: z.object({
          relevantTerms: z.array(z.string()).max(maxTerms)
        }),
        prompt: `Dado el mensaje del usuario y la lista de términos disponibles, 
                 identifica los ${maxTerms} términos más relevantes para la conversación.
                 
                 Mensaje: "${userMessage}"
                 
                 Términos disponibles: ${availableTerms.join(', ')}
                 
                 Retorna solo términos que son directamente relevantes al contexto.
                 Responde SOLO con un objeto JSON válido.`
      });

      return object.relevantTerms;
    } catch (error) {
      console.warn('[GlossaryStore] generateObject failed, trying text fallback:', error instanceof Error ? error.message : error);
      return await this.extractRelevantTermsWithFallback(userMessage, maxTerms, availableTerms);
    }
  }

  // Fallback method for models that struggle with structured output
  private async extractRelevantTermsWithFallback(
    userMessage: string,
    maxTerms: number,
    availableTerms: string[]
  ): Promise<string[]> {
    try {
      const { text } = await generateText({
        model: this.model,
        prompt: `Dado el mensaje del usuario y la lista de términos disponibles, 
identifica los ${maxTerms} términos más relevantes para la conversación.

Mensaje: "${userMessage}"

Términos disponibles: ${availableTerms.join(', ')}

Responde SOLO con un objeto JSON válido en este formato exacto:
{
  "relevantTerms": ["término1", "término2", ...]
}

NO incluyas texto adicional, SOLO el JSON con máximo ${maxTerms} términos.`
      });

      // Extract JSON from response
      let jsonText = text.trim();
      
      // Remove markdown code blocks if present
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
      }
      
      const parsed = JSON.parse(jsonText);
      const terms = Array.isArray(parsed.relevantTerms) 
        ? parsed.relevantTerms.slice(0, maxTerms).filter((t: any) => typeof t === 'string')
        : [];

      return terms;
    } catch (fallbackError) {
      console.error('[GlossaryStore] Fallback also failed:', fallbackError instanceof Error ? fallbackError.message : fallbackError);
      
      // Last resort: return empty array
      return [];
    }
  }

  // Get definitions for terms
  getDefinitions(terms: string[]): Record<string, string> {
    const definitions: Record<string, string> = {};
    terms.forEach(term => {
      const definition = this.terms.get(term.toLowerCase());
      if (definition) {
        definitions[term] = definition;
      }
    });
    return definitions;
  }

  // Build enriched context with terminology
  buildEnrichedContext(terms: string[]): string {
    const definitions = this.getDefinitions(terms);
    if (Object.keys(definitions).length === 0) return '';

    return `\n\n## Terminología Relevante:\n${Object.entries(definitions)
      .map(([term, def]) => `- **${term}**: ${def}`)
      .join('\n')}`;
  }
}

