import { z } from 'zod';

// Validation criterion for critic LLM
export const ValidationCriterionSchema = z.object({
  name: z.string().describe('Nombre del criterio de validación'),
  description: z.string().describe('Descripción de qué validar'),
  weight: z.number().min(0).max(100).default(10).describe('Peso porcentual (0-100) en la evaluación'),
  examples: z.array(z.string()).optional().describe('Ejemplos de respuestas que cumplen/no cumplen')
});

export type ValidationCriterion = z.infer<typeof ValidationCriterionSchema>;

// Schema for a guideline
export const GuidelineSchema = z.object({
  id: z.string(),
  condition: z.string().describe('WHEN: Cuándo aplicar esta guideline'),
  action: z.string().describe('WHAT: Qué debe hacer el agente'),
  priority: z.number().min(0).max(10).default(5),
  difficulty: z.enum(['low', 'medium', 'high']).default('medium').describe('Task complexity level for model selection'),
  tags: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  scope: z.enum(['global', 'journey', 'state']).default('global'),
  enabled: z.boolean().default(true),
  metadata: z.record(z.string(), z.any()).optional(),
  glossaryTerms: z.array(z.string()).optional().describe('Términos del glosario relevantes para esta guideline'),
  validationCriteria: z.array(ValidationCriterionSchema).optional().describe('Criterios específicos de validación para esta guideline')
});

export type Guideline = z.infer<typeof GuidelineSchema>;

// Match result with confidence score
export interface GuidelineMatch {
  guideline: Guideline;
  score: number;
  reason: string;
}

