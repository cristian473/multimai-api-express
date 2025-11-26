/**
 * Utility functions to index properties into RAG system
 * Use these functions to populate RAG with property data for semantic search
 */

import { getProperties } from "../db/repositories/properties";
import { storeRAG, updateRAGEmbeddings, deleteRAGByKeys } from "../db/repositories/rag";
import { Propiedad } from "../db/types";

/**
 * Build text description for a property to store in RAG
 */
function buildPropertyText(property: Propiedad): string {
  const parts: string[] = [];

  // Basic info
  parts.push(`${property.tipo_propiedad} "${property.nombre}"`);
  parts.push(property.descripcion || "");

  // Operation type
  const operacion = property.tipo_operacion === "Alquiler" ? "en alquiler" : "en venta";
  parts.push(`Propiedad ${operacion}`);

  // Price
  const precioText = `Precio: ${property.precio_moneda || ""} ${property.precio}`;
  if (property.tipo_operacion === "Alquiler") {
    parts.push(`${precioText} por mes`);
  } else {
    parts.push(precioText);
  }

  // Location
  if (property.ubicacion) {
    parts.push(`Ubicado en ${property.ubicacion}`);
  }
  if (property.direccion) {
    parts.push(`Dirección: ${property.direccion}`);
  }

  // Features
  if (property.ambientes) {
    parts.push(`${property.ambientes} ambientes`);
  }
  if (property.dormitorios) {
    parts.push(`${property.dormitorios} dormitorios`);
  }
  if (property.banos) {
    parts.push(`${property.banos} baños`);
  }
  if (property.superficie) {
    parts.push(`Superficie total: ${property.superficie}m²`);
  }
  if (property.superficie_cubierta) {
    parts.push(`Superficie cubierta: ${property.superficie_cubierta}m²`);
  }

  return parts.filter(Boolean).join(". ");
}

/**
 * Build keys for a property
 */
function buildPropertyKeys(uid: string, property: Propiedad): string[] {
  const keys = ["property", uid];

  // Add operation type
  if (property.tipo_operacion) {
    keys.push(property.tipo_operacion.toLowerCase());
  }

  // Add property type
  if (property.tipo_propiedad) {
    keys.push(property.tipo_propiedad.toLowerCase());
  }

  // Add location (simplified)
  if (property.ubicacion) {
    const locationKey = property.ubicacion
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
      .replace(/[^a-z0-9\s]/g, "") // Remove special chars
      .trim()
      .replace(/\s+/g, "_");
    keys.push(locationKey);
  }

  // Add unique property identifier
  if (property.id) {
    keys.push(`prop_${property.id}`);
  }

  return keys;
}

/**
 * Index a single property into RAG
 */
export async function indexPropertyToRAG(
  uid: string,
  property: Propiedad
): Promise<string> {
  try {
    console.log(`[Index RAG] Indexing property: ${property.id} - ${property.nombre}`);

    const text = buildPropertyText(property);
    const keys = buildPropertyKeys(uid, property);

    const metadata = {
      property_id: property.id,
      property_name: property.nombre,
      tipo_operacion: property.tipo_operacion,
      tipo_propiedad: property.tipo_propiedad,
      precio: property.precio,
      precio_moneda: property.precio_moneda,
      ubicacion: property.ubicacion,
      ambientes: property.ambientes,
      dormitorios: property.dormitorios,
      indexed_at: new Date().toISOString(),
    };

    const docRef = `users/${uid}/properties/${property.id}`;

    const docId = await storeRAG(keys, text, metadata, docRef);

    console.log(`[Index RAG] Successfully indexed property ${property.id} as ${docId}`);
    return docId;
  } catch (error) {
    console.error(`[Index RAG] Error indexing property ${property.id}:`, error);
    throw error;
  }
}

/**
 * Index all properties for a user into RAG
 */
export async function indexAllPropertiesToRAG(
  uid: string,
  options: {
    onlyActive?: boolean;
    batchSize?: number;
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<{ success: number; failed: number; total: number }> {
  const { onlyActive = true, batchSize = 10, onProgress } = options;

  try {
    console.log(`[Index RAG] Starting bulk indexing for user: ${uid}`);

    // Get all properties
    const allProperties = await getProperties(uid);
    
    // Filter active properties if requested
    const properties = onlyActive
      ? allProperties.filter((p) => p.activo && !p.deleted_at)
      : allProperties;

    console.log(`[Index RAG] Found ${properties.length} properties to index`);

    if (properties.length === 0) {
      return { success: 0, failed: 0, total: 0 };
    }

    let success = 0;
    let failed = 0;

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < properties.length; i += batchSize) {
      const batch = properties.slice(i, i + batchSize);
      
      const results = await Promise.allSettled(
        batch.map((property) => indexPropertyToRAG(uid, property))
      );

      results.forEach((result) => {
        if (result.status === "fulfilled") {
          success++;
        } else {
          failed++;
          console.error("[Index RAG] Failed to index property:", result.reason);
        }
      });

      // Report progress
      if (onProgress) {
        onProgress(i + batch.length, properties.length);
      }

      console.log(`[Index RAG] Progress: ${success + failed}/${properties.length} (${success} success, ${failed} failed)`);

      // Small delay between batches
      if (i + batchSize < properties.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`[Index RAG] Bulk indexing completed: ${success} success, ${failed} failed out of ${properties.length} total`);

    return { success, failed, total: properties.length };
  } catch (error) {
    console.error("[Index RAG] Error in bulk indexing:", error);
    throw error;
  }
}

/**
 * Update a property in RAG (re-index)
 */
export async function updatePropertyInRAG(
  uid: string,
  property: Propiedad
): Promise<string> {
  try {
    console.log(`[Index RAG] Updating property in RAG: ${property.id}`);

    const text = buildPropertyText(property);
    const keys = buildPropertyKeys(uid, property);

    const metadata = {
      property_id: property.id,
      property_name: property.nombre,
      tipo_operacion: property.tipo_operacion,
      tipo_propiedad: property.tipo_propiedad,
      precio: property.precio,
      precio_moneda: property.precio_moneda,
      ubicacion: property.ubicacion,
      ambientes: property.ambientes,
      dormitorios: property.dormitorios,
      updated_at: new Date().toISOString(),
    };

    const docRef = `users/${uid}/properties/${property.id}`;

    // This will delete old docs with these keys and create a new one
    const docId = await updateRAGEmbeddings(keys, text, metadata, docRef);

    console.log(`[Index RAG] Successfully updated property ${property.id} as ${docId}`);
    return docId;
  } catch (error) {
    console.error(`[Index RAG] Error updating property ${property.id}:`, error);
    throw error;
  }
}

/**
 * Remove a property from RAG
 */
export async function removePropertyFromRAG(
  uid: string,
  propertyId: string
): Promise<number> {
  try {
    console.log(`[Index RAG] Removing property from RAG: ${propertyId}`);

    // Delete by unique property key
    const deletedCount = await deleteRAGByKeys([`prop_${propertyId}`]);

    console.log(`[Index RAG] Removed ${deletedCount} documents for property ${propertyId}`);
    return deletedCount;
  } catch (error) {
    console.error(`[Index RAG] Error removing property ${propertyId}:`, error);
    throw error;
  }
}

/**
 * Clear all properties from RAG for a user
 */
export async function clearAllPropertiesFromRAG(uid: string): Promise<number> {
  try {
    console.log(`[Index RAG] Clearing all properties for user: ${uid}`);

    const deletedCount = await deleteRAGByKeys(["property", uid]);

    console.log(`[Index RAG] Cleared ${deletedCount} property documents for user ${uid}`);
    return deletedCount;
  } catch (error) {
    console.error(`[Index RAG] Error clearing properties for user ${uid}:`, error);
    throw error;
  }
}

/**
 * Re-index all properties (clear and re-index)
 */
export async function reindexAllProperties(
  uid: string,
  options: {
    onlyActive?: boolean;
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<{ success: number; failed: number; total: number; cleared: number }> {
  try {
    console.log(`[Index RAG] Starting full re-index for user: ${uid}`);

    // Clear existing
    const cleared = await clearAllPropertiesFromRAG(uid);
    console.log(`[Index RAG] Cleared ${cleared} existing documents`);

    // Wait a bit for deletions to propagate
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Index all
    const result = await indexAllPropertiesToRAG(uid, options);

    return { ...result, cleared };
  } catch (error) {
    console.error(`[Index RAG] Error in full re-index:`, error);
    throw error;
  }
}


