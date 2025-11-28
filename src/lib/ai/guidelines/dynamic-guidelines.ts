import type { Guideline } from '../types/guideline';
import type { UserDocument } from '../../db/repositories/user-documents';

/**
 * Generate a dynamic context search guideline based on user's uploaded documents
 * 
 * @param documents - Array of documents uploaded by the user
 * @returns Guideline object if documents exist, null otherwise
 * 
 * Behavior:
 * - No documents → returns null (guideline doesn't exist)
 * - Documents: "Políticas de alquiler" → Question about policies → ACTIVATES
 * - Documents: "Políticas de alquiler" → Question about houses in Palermo → DOESN'T ACTIVATE
 */
export function generateContextSearchGuideline(documents: UserDocument[]): Guideline | null {
  // If no documents, don't create the guideline
  if (!documents || documents.length === 0) {
    console.log('[DynamicGuidelines] No documents found, context_search guideline not created');
    return null;
  }

  // Get all document labels
  const labels = documents.map(d => d.label);
  const labelsString = labels.join(', ');

  // Create guideline with dynamic condition based on document labels
  const guideline: Guideline = {
    id: 'context_search',
    condition: `El usuario hace preguntas o consultas relacionadas con los siguientes temas que tienen documentos de contexto cargados: ${labelsString}. 
Solo activar esta guideline si la pregunta del usuario es CLARAMENTE relevante a alguno de estos temas específicos.
NO activar para preguntas generales sobre propiedades, visitas, o información que no esté relacionada con estos documentos.`,
    action: `Buscar información relevante en los documentos de contexto disponibles (${labelsString}) para responder la consulta del usuario con información precisa y verificada de los documentos cargados.`,
    priority: 9,
    difficulty: 'medium',
    tools: ['search_context'],
    enabled: true,
    scope: 'global',
    tags: ['context', 'rag', 'documents', 'dynamic'],
    metadata: {
      isDynamic: true,
      availableDocuments: documents.map(d => ({
        id: d.id,
        label: d.label,
        ragId: d.ragId,
        ragKeys: d.ragKeys,
      })),
      documentLabels: labels,
    },
    validationCriteria: [
      {
        name: 'Uso de información de documentos',
        description: 'La respuesta debe incluir información específica obtenida de los documentos de contexto cuando sea relevante',
        weight: 25,
        examples: [
          'CORRECTO: Según nuestras políticas de alquiler, el depósito es de 2 meses...',
          'INCORRECTO: Inventar políticas o información no presente en los documentos'
        ]
      },
      {
        name: 'Citación de fuente',
        description: 'Cuando se use información de un documento específico, mencionarlo de forma natural',
        weight: 15,
        examples: [
          'CORRECTO: De acuerdo a nuestras políticas, ...',
          'INCORRECTO: No mencionar la fuente cuando es información específica del documento'
        ]
      }
    ]
  };

  console.log(`[DynamicGuidelines] Created context_search guideline with ${documents.length} documents: ${labelsString}`);
  return guideline;
}

/**
 * Generate all dynamic guidelines for a user
 * Currently only includes context_search, but can be extended
 * 
 * @param documents - User's uploaded documents
 * @returns Array of dynamic guidelines (filtered for null values)
 */
export function generateDynamicGuidelines(documents: UserDocument[]): Guideline[] {
  const guidelines: Guideline[] = [];

  // Add context search guideline if documents exist
  const contextSearchGuideline = generateContextSearchGuideline(documents);
  if (contextSearchGuideline) {
    guidelines.push(contextSearchGuideline);
  }

  // Future: Add more dynamic guidelines here based on other conditions

  console.log(`[DynamicGuidelines] Generated ${guidelines.length} dynamic guidelines`);
  return guidelines;
}

/**
 * Merge static guidelines with dynamic ones
 * Dynamic guidelines are added at the end but maintain their priority
 * 
 * @param staticGuidelines - Base guidelines from multimai-guidelines
 * @param dynamicGuidelines - Dynamically generated guidelines
 * @returns Combined array of guidelines
 */
export function mergeGuidelines(
  staticGuidelines: Guideline[],
  dynamicGuidelines: Guideline[]
): Guideline[] {
  // Create a map to avoid duplicates (dynamic overrides static if same id)
  const guidelineMap = new Map<string, Guideline>();

  // Add static guidelines first
  staticGuidelines.forEach(g => guidelineMap.set(g.id, g));

  // Add dynamic guidelines (will override if same id exists)
  dynamicGuidelines.forEach(g => guidelineMap.set(g.id, g));

  return Array.from(guidelineMap.values());
}



