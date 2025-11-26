import { db, admin } from "../firebase";
import { ragCollection } from "../constants";
import { RAGDocument } from "../types";
import { generateText, embed } from "ai";
import { getOpenRouterModel } from "@/lib/ai/openrouter";
import { AI_CONFIG } from "@/lib/ai/config";
import { openai } from "@ai-sdk/openai";

const FieldValue = admin.firestore.FieldValue;

/**
 * Generate propositions from a single text segment
 * Adapts the number of propositions based on text length
 */
async function generateSegmentPropositions(segment: string): Promise<string[]> {
  try {
    // Determine expected propositions based on segment length
    const wordCount = segment.split(/\s+/).length;
    let expectedPropositions = 1;
    if (wordCount > 50) expectedPropositions = Math.min(5, Math.ceil(wordCount / 30));
    else if (wordCount > 20) expectedPropositions = 2;

    const prompt = `Extrae proposiciones atómicas (hechos o declaraciones) del siguiente texto en español.
Cada proposición debe ser una declaración independiente que capture una única pieza de información.
Genera aproximadamente ${expectedPropositions} proposición(es).
Devuelve SOLO un array JSON de strings, nada más.

Texto: ${segment}

Ejemplo de formato de salida:
["La propiedad tiene 3 dormitorios", "La propiedad está ubicada en Buenos Aires", "El precio es $200,000"]`;

    const { text: response } = await generateText({
      model: getOpenRouterModel(AI_CONFIG.PROPOSITION_GENERATOR_MODEL),
      prompt,
      temperature: 0.3,
    });

    // Parse JSON response
    const cleaned = response.trim().replace(/```json\n?/g, "").replace(/```\n?/g, "");
    const propositions = JSON.parse(cleaned);
    
    if (!Array.isArray(propositions)) {
      throw new Error("Response is not an array");
    }

    return propositions;
  } catch (error) {
    console.error("Error generating segment propositions:", error);
    // Fallback: return the segment as a single proposition
    return [segment];
  }
}

/**
 * Generate propositions from text using parallel processing
 * Splits text by breaklines and processes each segment in parallel
 */
async function generatePropositions(text: string): Promise<string[]> {
  try {
    // Step 1: Split text by breaklines and filter empty segments
    const segments = text
      .split(/\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (segments.length === 0) {
      console.log("[RAG] No valid segments found in text");
      return [text.trim() || "Empty document"];
    }

    console.log(`[RAG] Split text into ${segments.length} segments for parallel processing`);

    // Step 2: Process segments in parallel with fast Groq model
    const propositionArrays = await Promise.all(
      segments.map(segment => generateSegmentPropositions(segment))
    );

    // Step 3: Flatten results
    const allPropositions = propositionArrays.flat();
    console.log(`[RAG] Generated ${allPropositions.length} total propositions from ${segments.length} segments`);

    return allPropositions;
  } catch (error) {
    console.error("Error generating propositions:", error);
    // Fallback: return the original text as a single proposition
    return [text];
  }
}

/**
 * Validation result for a single proposition
 */
interface PropositionValidation {
  proposition: string;
  isValid: boolean;
  issues: string[];
}

/**
 * Validate propositions for quality and veracity
 * Checks if each proposition is atomic, clear, complete, and doesn't contain invented information
 */
async function validatePropositions(
  propositions: string[],
  originalText: string
): Promise<PropositionValidation[]> {
  try {
    const prompt = `Eres un validador de proposiciones. Evalúa cada proposición según los siguientes criterios:

CRITERIOS DE CALIDAD:
- Atómica: Contiene una sola pieza de información
- Clara: Es fácil de entender
- Completa: No le falta contexto esencial

CRITERIOS DE VERACIDAD:
- La información debe estar presente en el texto original
- No debe contener información inventada o exagerada
- No debe contradecir el texto original

TEXTO ORIGINAL:
${originalText}

PROPOSICIONES A VALIDAR:
${propositions.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Devuelve SOLO un array JSON con el siguiente formato para cada proposición:
[
  {"index": 0, "isValid": true, "issues": []},
  {"index": 1, "isValid": false, "issues": ["No es atómica", "Contiene información inventada"]}
]`;

    const { text: response } = await generateText({
      model: getOpenRouterModel(AI_CONFIG.PROPOSITION_VALIDATOR_MODEL),
      prompt,
      temperature: 0.2,
    });

    // Parse JSON response
    const cleaned = response.trim().replace(/```json\n?/g, "").replace(/```\n?/g, "");
    const validations = JSON.parse(cleaned);

    if (!Array.isArray(validations)) {
      throw new Error("Validation response is not an array");
    }

    // Map validations to propositions
    return propositions.map((proposition, index) => {
      const validation = validations.find((v: any) => v.index === index);
      return {
        proposition,
        isValid: validation?.isValid ?? true,
        issues: validation?.issues ?? [],
      };
    });
  } catch (error) {
    console.error("Error validating propositions:", error);
    // Fallback: mark all as valid
    return propositions.map(proposition => ({
      proposition,
      isValid: true,
      issues: [],
    }));
  }
}

/**
 * Correct invalid propositions based on validation feedback
 */
async function correctPropositions(
  invalidValidations: PropositionValidation[],
  originalText: string
): Promise<string[]> {
  if (invalidValidations.length === 0) {
    return [];
  }

  try {
    const prompt = `Eres un corrector de proposiciones. Corrige las siguientes proposiciones inválidas basándote en el texto original y los problemas identificados.

TEXTO ORIGINAL:
${originalText}

PROPOSICIONES A CORREGIR:
${invalidValidations.map((v, i) => `${i + 1}. Proposición: "${v.proposition}"
   Problemas: ${v.issues.join(', ')}`).join('\n\n')}

INSTRUCCIONES:
- Si la proposición contiene información inventada, elimínala o corrígela basándote SOLO en el texto original
- Si no es atómica, divídela en proposiciones más pequeñas
- Si no es clara, reescríbela de forma más clara
- Mantén el idioma español

Devuelve SOLO un array JSON de strings con las proposiciones corregidas:
["Proposición corregida 1", "Proposición corregida 2"]`;

    const { text: response } = await generateText({
      model: getOpenRouterModel(AI_CONFIG.PROPOSITION_CORRECTOR_MODEL),
      prompt,
      temperature: 0.3,
    });

    // Parse JSON response
    const cleaned = response.trim().replace(/```json\n?/g, "").replace(/```\n?/g, "");
    const corrected = JSON.parse(cleaned);

    if (!Array.isArray(corrected)) {
      throw new Error("Correction response is not an array");
    }

    console.log(`[RAG] Corrected ${invalidValidations.length} invalid propositions into ${corrected.length} propositions`);
    return corrected;
  } catch (error) {
    console.error("Error correcting propositions:", error);
    // Fallback: return original invalid propositions
    return invalidValidations.map(v => v.proposition);
  }
}

/**
 * Generate embeddings for text using text-embedding-3-small
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const { embedding } = await embed({
      model: openai.textEmbeddingModel('text-embedding-3-small'),
      value: text,
    });
    return embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    throw error;
  }
}

/**
 * Average multiple embeddings into a single vector
 */
function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    throw new Error("Cannot average empty embeddings array");
  }
  
  if (embeddings.length === 1) {
    return embeddings[0];
  }

  const dimension = embeddings[0].length;
  const averaged = new Array(dimension).fill(0);

  for (const embedding of embeddings) {
    for (let i = 0; i < dimension; i++) {
      averaged[i] += embedding[i];
    }
  }

  for (let i = 0; i < dimension; i++) {
    averaged[i] /= embeddings.length;
  }

  return averaged;
}

/**
 * Improve/expand query using GPT-4o-mini for better retrieval
 */
async function improveQuery(query: string): Promise<string> {
  try {
    const prompt = `You are a query expansion expert. Given a user query, expand it with relevant synonyms, related terms, and context to improve semantic search results.
Keep the expansion concise and relevant. Return ONLY the improved query text in english, nothing else.

Original query: ${query}

Improved query in english:`;

    const { text: improvedQuery } = await generateText({
      model: getOpenRouterModel("openai/gpt-oss-20b"),
      prompt,
      temperature: 0.5,
    });

    return improvedQuery.trim();
  } catch (error) {
    console.error("Error improving query:", error);
    // Fallback: return original query
    return query;
  }
}

/**
 * Store RAG document with generated propositions and embeddings
 * @param keys - Array of key identifiers for filtering
 * @param text - Original text to process
 * @param metadata - Optional metadata object
 * @param docRef - Optional document reference
 * @returns Document ID of stored RAG document
 */
export async function storeRAG(
  keys: string[],
  text: string,
  metadata?: Record<string, any>,
  docRef?: string
): Promise<string> {
  try {
    console.log("[RAG] Storing document with keys:", keys);

    // Step 1: Generate propositions (with split and parallel processing)
    console.log("[RAG] Generating propositions...");
    const rawPropositions = await generatePropositions(text);
    console.log(`[RAG] Generated ${rawPropositions.length} raw propositions`);

    // Step 2: Validate propositions
    console.log("[RAG] Validating propositions...");
    const validations = await validatePropositions(rawPropositions, text);
    
    const validPropositions = validations.filter(v => v.isValid).map(v => v.proposition);
    const invalidValidations = validations.filter(v => !v.isValid);
    
    console.log(`[RAG] Valid: ${validPropositions.length}, Invalid: ${invalidValidations.length}`);

    // Step 3: Correct invalid propositions
    let finalPropositions = [...validPropositions];
    if (invalidValidations.length > 0) {
      console.log("[RAG] Correcting invalid propositions...");
      const correctedPropositions = await correctPropositions(invalidValidations, text);
      finalPropositions = [...finalPropositions, ...correctedPropositions];
      console.log(`[RAG] Added ${correctedPropositions.length} corrected propositions`);
    }

    console.log(`[RAG] Final propositions count: ${finalPropositions.length}`);

    // Step 4: Generate embeddings for final propositions
    console.log("[RAG] Generating embeddings for propositions...");
    const propositionEmbeddings = await Promise.all(
      finalPropositions.map((prop) => generateEmbedding(prop))
    );

    // Step 5: Average embeddings
    const averagedEmbedding = averageEmbeddings(propositionEmbeddings);
    console.log(`[RAG] Averaged embeddings to vector of dimension ${averagedEmbedding.length}`);

    // Step 6: Store in Firestore
    const ragDoc: Omit<RAGDocument, "id"> = {
      keyIdentifiers: keys,
      embeddings: averagedEmbedding,
      propositions: finalPropositions,
      originalText: text,
      metadata: metadata || {},
      docRef: docRef || null,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    };

    const docRefResult = await db.collection(ragCollection()).add(ragDoc);
    console.log(`[RAG] Stored document with ID: ${docRefResult.id}`);

    return docRefResult.id;
  } catch (error) {
    console.error("[RAG] Error storing document:", error);
    throw error;
  }
}

/**
 * Retrieve RAG documents by keys and query using vector search
 * @param keys - Array of keys to filter by
 * @param query - Search query
 * @param limit - Maximum number of results (default: 10)
 * @returns Array of matching RAG documents with similarity scores
 */
export async function retrievalRAG(
  keys: string[],
  query: string,
  limit: number = 10
): Promise<Array<RAGDocument & { similarity?: number }>> {
  try {
    console.log("[RAG] Retrieving documents with keys:", keys);
    console.log("[RAG] Original query:", query);

    // Step 1: Improve query
    console.log("[RAG] Improving query...");
    const improvedQuery = await improveQuery(query);
    console.log("[RAG] Improved query:", improvedQuery);

    // Step 2: Generate embedding for improved query
    console.log("[RAG] Generating query embedding...");
    const queryEmbedding = await generateEmbedding(improvedQuery);

    // Step 3: Build Firestore query with vector search
    console.log("[RAG] Searching Firestore with vector search...");
    
    // Note: Firestore vector search requires manual index configuration
    // The query uses findNearest() which is only available with vector indexes
    const querySnapshot = await db
      .collection(ragCollection())
      .where("keyIdentifiers", "array-contains-any", keys)
      .findNearest({
        vectorField: "embeddings",
        queryVector: queryEmbedding,
        limit: limit,
        distanceMeasure: "COSINE",
        distanceResultField: "_distance",
      })
      .get();

    if (querySnapshot.empty) {
      console.log("[RAG] No documents found");
      return [];
    }

    console.log('[retrievalRAG] Query snapshot size:', querySnapshot.docs.length);

    // Step 4: Map results
    const results: Array<RAGDocument & { similarity?: number }> = querySnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        keyIdentifiers: data.keyIdentifiers || [],
        embeddings: data.embeddings || [],
        propositions: data.propositions || [],
        originalText: data.originalText || "",
        metadata: data.metadata || {},
        docRef: data.docRef,
        created_at: data.created_at,
        updated_at: data.updated_at,
        // Firestore vector search automatically includes distance
        similarity: data._distance ? 1 - data._distance : undefined,
      };
    });

    console.log(`[RAG] Found ${results.length} documents`);
    return results;
  } catch (error) {
    console.error("[RAG] Error retrieving documents:", error);
    
    // Fallback: if vector search fails (no index configured), do basic filtering
    console.log("[RAG] Falling back to basic key filtering (no vector search)");
    try {
      const fallbackSnapshot = await db
        .collection(ragCollection())
        .where("keyIdentifiers", "array-contains-any", keys)
        .limit(limit)
        .get();

      return fallbackSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          keyIdentifiers: data.keyIdentifiers || [],
          embeddings: data.embeddings || [],
          propositions: data.propositions || [],
          originalText: data.originalText || "",
          metadata: data.metadata || {},
          docRef: data.docRef,
          created_at: data.created_at,
          updated_at: data.updated_at,
        };
      });
    } catch (fallbackError) {
      console.error("[RAG] Fallback query also failed:", fallbackError);
      throw fallbackError;
    }
  }
}

/**
 * Update embeddings for RAG documents by keys
 * Finds all documents with the specified keys, deletes them, and recreates with new embeddings
 * @param keys - Array of keys to identify documents to update
 * @param text - New text to generate embeddings from
 * @param metadata - Optional metadata object
 * @param docRef - Optional document reference
 * @returns Document ID of newly created document
 */
export async function updateRAGEmbeddings(
  keys: string[],
  text: string,
  metadata?: Record<string, any>,
  docRef?: string
): Promise<string> {
  try {
    console.log(`[RAG] Updating documents with keys:`, keys);

    // Step 1: Delete all existing documents with these keys
    console.log("[RAG] Deleting existing documents...");
    const deletedCount = await deleteRAGByKeys(keys);
    console.log(`[RAG] Deleted ${deletedCount} existing documents`);

    // Step 2: Create new document with updated embeddings
    console.log("[RAG] Creating new document with updated embeddings...");
    const newDocId = await storeRAG(keys, text, metadata, docRef);

    console.log(`[RAG] Successfully updated documents. New document ID: ${newDocId}`);
    return newDocId;
  } catch (error) {
    console.error(`[RAG] Error updating documents with keys:`, keys, error);
    throw error;
  }
}

/**
 * Delete RAG documents by keys
 * @param keys - Array of keys to match for deletion
 * @returns Number of documents deleted
 */
export async function deleteRAGByKeys(keys: string[]): Promise<number> {
  try {
    console.log("[RAG] Deleting documents with keys:", keys);

    // Step 1: Find all documents matching the keys
    const querySnapshot = await db
      .collection(ragCollection())
      .where("keyIdentifiers", "array-contains-any", keys)
      .get();

    if (querySnapshot.empty) {
      console.log("[RAG] No documents found to delete");
      return 0;
    }

    // Step 2: Delete in batches (Firestore batch limit is 500)
    const batchSize = 500;
    let deletedCount = 0;
    const docs = querySnapshot.docs;

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = db.batch();
      const batchDocs = docs.slice(i, i + batchSize);

      batchDocs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      deletedCount += batchDocs.length;
      console.log(`[RAG] Deleted batch of ${batchDocs.length} documents`);
    }

    console.log(`[RAG] Total deleted: ${deletedCount} documents`);
    return deletedCount;
  } catch (error) {
    console.error("[RAG] Error deleting documents:", error);
    throw error;
  }
}

