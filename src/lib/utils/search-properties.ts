import axios from 'axios';
import { getProperties } from '../db/repositories/properties';
import { Propiedad } from '../db/types';
import { retrievalRAG } from '../db/repositories/rag';

// Tipos para el sistema de scoring
export type ScoreLevel = 'alto' | 'medio' | 'bajo';

export interface PropertyWithScore extends Propiedad {
  score: number;
  scoreLevel: ScoreLevel;
  scoreReasons: string[];
}

export interface SearchResult {
  altas: PropertyWithScore[];
  medias: PropertyWithScore[];
  bajas: PropertyWithScore[];
  additionalText: string;
  totalResults: number;
}

export interface SearchPropertiesParams {
  ubicacion?: string;
  precio?: string[];
  tipo_operacion: string;
  tipo_propiedad?: string;
  ambientes?: number;
  otro?: string;
}

function modificarPorcentaje(num: number, porcentaje: number) {
  return num + (num * (porcentaje / 100));
}

function formatPrice(precio: any) {
  if (Array.isArray(precio) && typeof precio[0] === 'string' && precio[0].includes('-')) {
    return precio[0].split('-').map(Number);
  }
  if (Array.isArray(precio) && precio.length > 1) {
    return precio.map(Number);
  }
  if (typeof precio === 'string') {
    const transform = Number(precio);
    if (Number.isNaN(transform)) {
      return 0;
    }
    return transform;
  }
  return 0;
}

async function geocodificarDireccion(direccion: string) {
  const apiKey = process.env.GOOGLE_API_KEY;
  let direccionConPais = direccion;

  if (!direccion.toLowerCase().includes("argentina")) {
    direccionConPais = `${direccion}, Argentina`;
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(direccionConPais)}&key=${apiKey}`;

  try {
    const response = await axios.get(url);
    if (response.data.status === "OK") {
      const { lat, lng } = response.data.results[0].geometry.location;
      console.log(`Coordenadas de ${direccion}:`, { lat, lng });
      return { lat, lng };
    } else {
      console.error("Error en la geocodificación:", response.data.status);
      return null;
    }
  } catch (error) {
    console.error("Error en la solicitud:", error);
    return null;
  }
}

const R = 6371; // Radio de la Tierra en kilómetros

function calcularDistancia(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculatePropertyScore(
  property: Propiedad,
  criterios: SearchPropertiesParams,
  distancia?: number
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. Tipo de operación (OBLIGATORIO - 0 o 30 puntos)
  if (criterios.tipo_operacion) {
    const tipoOperacionBuscado = criterios.tipo_operacion === 'Compra' ? 'Venta' : criterios.tipo_operacion;
    if (property.tipo_operacion === tipoOperacionBuscado) {
      score += 30;
      reasons.push('Tipo de operación coincide');
    }
  }

  // 2. Tipo de propiedad (25 puntos)
  if (criterios.tipo_propiedad) {
    if (property.tipo_propiedad === criterios.tipo_propiedad) {
      score += 25;
      reasons.push('Tipo de propiedad coincide exactamente');
    } else {
      if (criterios.tipo_propiedad === 'Terreno') {
        reasons.push('Tipo de propiedad no coincide (Terreno solo con Terreno)');
      } else if (criterios.tipo_propiedad === 'Departamento' && property.tipo_propiedad === 'Casa') {
        score += 15;
        reasons.push('Tipo de propiedad compatible (Casa por Departamento)');
      } else if (criterios.tipo_propiedad === 'Casa' && property.tipo_propiedad === 'Departamento') {
        score += 15;
        reasons.push('Tipo de propiedad compatible (Departamento por Casa)');
      } else if (property.tipo_propiedad !== 'Terreno') {
        score += 10;
        reasons.push('Tipo de propiedad diferente pero compatible');
      }
    }
  } else {
    score += 15;
  }

  // 3. Ubicación/Distancia (20 puntos)
  if (distancia !== undefined) {
    if (distancia <= 2) {
      score += 20;
      reasons.push('Ubicación muy cercana (<2km)');
    } else if (distancia <= 5) {
      score += 15;
      reasons.push('Ubicación cercana (2-5km)');
    } else if (distancia <= 10) {
      score += 10;
      reasons.push('Ubicación a distancia moderada (5-10km)');
    } else {
      score += 5;
      reasons.push('Ubicación lejana (>10km)');
    }
  } else if (criterios.ubicacion) {
    score += 10;
  } else {
    score += 15;
  }

  // 4. Precio (15 puntos)
  if (criterios.precio) {
    const precioFormateado = formatPrice(criterios.precio);
    const [minPrecio, maxPrecio] = Array.isArray(precioFormateado)
      ? precioFormateado
      : [modificarPorcentaje(precioFormateado as number, -10), modificarPorcentaje(precioFormateado as number, 10)];

    if (property.precio >= minPrecio && property.precio <= maxPrecio) {
      score += 15;
      reasons.push('Precio dentro del rango solicitado');
    } else {
      const diferenciaPorcentaje = property.precio < minPrecio
        ? ((minPrecio - property.precio) / minPrecio) * 100
        : ((property.precio - maxPrecio) / maxPrecio) * 100;

      if (diferenciaPorcentaje <= 20) {
        score += 10;
        reasons.push('Precio cercano al rango (±20%)');
      } else if (diferenciaPorcentaje <= 40) {
        score += 5;
        reasons.push('Precio algo alejado del rango (±40%)');
      } else {
        reasons.push('Precio fuera del rango deseado');
      }
    }
  } else {
    score += 10;
  }

  // 5. Ambientes/Dormitorios (10 puntos)
  if (criterios.ambientes) {
    const diferencia = Math.abs(Number(property.dormitorios ?? 1) - criterios.ambientes);
    if (diferencia === 0) {
      score += 10;
      reasons.push('Cantidad de ambientes exacta');
    } else if (diferencia === 1) {
      score += 7;
      reasons.push('Cantidad de ambientes muy cercana (±1)');
    } else if (diferencia === 2) {
      score += 4;
      reasons.push('Cantidad de ambientes cercana (±2)');
    } else {
      reasons.push('Cantidad de ambientes diferente');
    }
  } else {
    score += 5;
  }

  return { score, reasons };
}

function getScoreLevel(score: number): ScoreLevel {
  if (score >= 70) return 'alto';
  if (score >= 50) return 'medio';
  return 'bajo';
}

/**
 * Normalize text for location matching by removing accents and converting to lowercase
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Check if search location matches property location textually
 */
function checkLocationTextMatch(
  searchLocation: string,
  propertyLocation: string
): boolean {
  const normalizedSearch = normalizeText(searchLocation.trim());
  const normalizedProperty = normalizeText(propertyLocation.trim());
  
  // Check if search location is contained in property location
  return normalizedProperty.includes(normalizedSearch);
}

/**
 * Calculate hybrid score combining semantic similarity, proximity, and criteria matching
 * Total: 100 points
 * - Semantic: 50 points
 * - Proximity: 30 points (with text match bonus)
 * - Criteria: 20 points (type, price, rooms)
 */
function calculateHybridScore(
  property: Propiedad,
  ragSimilarity: number,
  criterios: SearchPropertiesParams,
  distancia?: number,
  locationTextMatch?: boolean
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. SEMANTIC SCORE (50 points max)
  const semanticScore = ragSimilarity * 50;
  score += semanticScore;
  reasons.push(`Similitud semántica: ${(ragSimilarity * 100).toFixed(1)}%`);

  // 2. PROXIMITY SCORE (30 points max)
  if (criterios.ubicacion) {
    // Text match bonus
    if (locationTextMatch) {
      score += 15;
      reasons.push('Ubicación coincide textualmente (+15 bonus)');
    }

    // Distance-based score
    if (distancia !== undefined) {
      if (distancia <= 2) {
        score += 30;
        reasons.push(`Muy cerca: ${distancia.toFixed(1)}km`);
      } else if (distancia <= 5) {
        score += 20;
        reasons.push(`Cerca: ${distancia.toFixed(1)}km`);
      } else if (distancia <= 10) {
        score += 10;
        reasons.push(`Distancia moderada: ${distancia.toFixed(1)}km`);
      } else {
        score += 5;
        reasons.push(`Distancia: ${distancia.toFixed(1)}km`);
      }
    } else {
      // No coordinates but location was specified
      score += 15;
    }
  } else {
    // No location specified - give base score
    score += 15;
  }

  // 3. CRITERIA SCORE (20 points max)
  // 3a. Property Type (8 points)
  if (criterios.tipo_propiedad) {
    if (property.tipo_propiedad === criterios.tipo_propiedad) {
      score += 8;
      reasons.push('Tipo de propiedad coincide exactamente');
    } else if (
      (criterios.tipo_propiedad === 'Casa' && property.tipo_propiedad === 'Departamento') ||
      (criterios.tipo_propiedad === 'Departamento' && property.tipo_propiedad === 'Casa')
    ) {
      score += 4;
      reasons.push('Tipo de propiedad compatible');
    }
  } else {
    score += 4;
  }

  // 3b. Price Range (7 points)
  if (criterios.precio) {
    const precioFormateado = formatPrice(criterios.precio);
    const [minPrecio, maxPrecio] = Array.isArray(precioFormateado)
      ? precioFormateado
      : [modificarPorcentaje(precioFormateado as number, -10), modificarPorcentaje(precioFormateado as number, 10)];

    if (property.precio >= minPrecio && property.precio <= maxPrecio) {
      score += 7;
      reasons.push('Precio dentro del rango');
    } else {
      const diferenciaPorcentaje = property.precio < minPrecio
        ? ((minPrecio - property.precio) / minPrecio) * 100
        : ((property.precio - maxPrecio) / maxPrecio) * 100;

      if (diferenciaPorcentaje <= 20) {
        score += 5;
        reasons.push('Precio cercano al rango');
      } else if (diferenciaPorcentaje <= 40) {
        score += 2;
        reasons.push('Precio algo alejado del rango');
      }
    }
  } else {
    score += 3;
  }

  // 3c. Rooms/Ambientes (5 points)
  if (criterios.ambientes) {
    const diferencia = Math.abs(Number(property.dormitorios ?? 1) - criterios.ambientes);
    if (diferencia === 0) {
      score += 5;
      reasons.push('Ambientes exactos');
    } else if (diferencia === 1) {
      score += 3;
      reasons.push('Ambientes muy cercanos');
    } else if (diferencia === 2) {
      score += 1;
      reasons.push('Ambientes cercanos');
    }
  } else {
    score += 2;
  }

  // Cap score at 100
  score = Math.min(score, 100);

  return { score, reasons };
}

export function formatSearchResults(searchResult: SearchResult): {
  propertiesToShow: PropertyWithScore[];
  message: string;
} {
  const { altas, medias, bajas } = searchResult;

  // High match properties
  if (altas.length > 0) {
    const hasMedium = medias.length > 0;
    
    if (altas.length > 5) {
      const mainMessage = `Encontré ${altas.length} propiedades que coinciden muy bien con lo que buscás. Te muestro las 5 mejores opciones, pero tengo ${altas.length - 5} más que podrían interesarte.`;
      const nearbyMessage = hasMedium ? `\n\nTambién tengo otras ${medias.length} opciones cerca que podrían interesarte.` : '';
      
      return {
        propertiesToShow: altas.slice(0, 5),
        message: mainMessage + nearbyMessage
      };
    } else if (altas.length === 5) {
      const mainMessage = 'Encontré estas 5 propiedades que coinciden muy bien con lo que buscás.';
      const nearbyMessage = hasMedium ? `\n\nTambién tengo otras ${medias.length} opciones cerca como alternativas.` : '';
      
      return {
        propertiesToShow: altas,
        message: mainMessage + nearbyMessage
      };
    } else {
      const mainMessage = 'Encontré esta propiedad que coincide muy bien con lo que buscás.';
      const nearbyMessage = hasMedium ? `\n\nTambién tengo otras ${medias.length} opciones cerca como alternativas.` : '';
      
      return {
        propertiesToShow: altas,
        message: mainMessage + nearbyMessage
      };
    }
  }

  // Medium match properties (nearby options)
  if (medias.length > 0) {
    if (medias.length > 5 ) {
      return {
        propertiesToShow: medias.slice(0, 5),
        message: `También tengo otras opciones cerca como estas ${medias.length} propiedades. Te muestro las 5 mejores y si querés puedo mostrarte ${medias.length - 5} más:`
      };
    } else {
      return {
        propertiesToShow: medias,
        message: `También tengo ${medias.length === 1 ? 'esta opción cerca' : 'estas opciones cerca'} que podrían interesarte:`
      };
    }
  }

  // Low match properties
  if (bajas.length > 0) {
    if (bajas.length > 5) {
      return {
        propertiesToShow: bajas.slice(0, 5),
        message: `No encontré propiedades con los criterios específicos que buscás. De todas formas, te muestro ${Math.min(5, bajas.length)} de las ${bajas.length} propiedades que tengo publicadas por si alguna te interesa:`
      };
    } else {
      return {
        propertiesToShow: bajas,
        message: `No encontré propiedades con los criterios específicos que buscás. Te muestro ${bajas.length === 1 ? 'esta propiedad que tengo publicada' : 'estas propiedades que tengo publicadas'} por si te interesa:`
      };
    }
  }

  return {
    propertiesToShow: [],
    message: searchResult.additionalText || 'No encontré propiedades con esos criterios en este momento.'
  };
}

// Función para obtener una propiedad específica por ID
export async function getPropertyById(uid: string, propertyId: string): Promise<Propiedad | null> {
  try {
    const properties = await getProperties(uid);
    const property = properties.find((p: any) => String(p.id_propiedad) === propertyId);
    return property || null;
  } catch (error) {
    console.error('Error getting property by ID:', error);
    return null;
  }
}

export async function queryProperties(uid: string, criterios: SearchPropertiesParams): Promise<SearchResult> {
  try {
    const properties = await getProperties(uid);
    console.log('Total properties:', properties.length);
    console.log('Criterios:', criterios);

    // Formatear precio si existe
    if (criterios.precio) {
      criterios.precio = formatPrice(criterios.precio) as any;
    }

    // FILTRADO OBLIGATORIO: Tipo de operación
    let filteredProperties = properties;
    if (criterios.tipo_operacion) {
      const tipoOperacionBuscado = criterios.tipo_operacion === 'Compra' ? 'Venta' : criterios.tipo_operacion;
      filteredProperties = filteredProperties.filter(item => item.tipo_operacion === tipoOperacionBuscado);
    }

    if (filteredProperties.length === 0) {
      return {
        altas: [],
        medias: [],
        bajas: [],
        additionalText: `No tengo propiedades publicadas para ${criterios.tipo_operacion === 'Compra' ? 'Venta' : criterios.tipo_operacion}.`,
        totalResults: 0
      };
    }

    // Filtrar terrenos
    if (criterios.tipo_propiedad === 'Terreno') {
      filteredProperties = filteredProperties.filter(item => item.tipo_propiedad === 'Terreno');
      if (filteredProperties.length === 0) {
        return {
          altas: [],
          medias: [],
          bajas: [],
          additionalText: 'No tengo terrenos publicados en este momento.',
          totalResults: 0
        };
      }
    }

    // Geocodificar ubicación si existe
    let ubicacionCoordenadas: { lat: number; lng: number } | null = null;
    const distancias = new Map<string, number>();

    if (criterios.ubicacion) {
      ubicacionCoordenadas = await geocodificarDireccion(criterios.ubicacion);

      if (ubicacionCoordenadas) {
        filteredProperties.forEach((prop: any) => {
          if (prop.coordenadas) {
            const distancia = calcularDistancia(
              ubicacionCoordenadas!.lat,
              ubicacionCoordenadas!.lng,
              prop.coordenadas.lat,
              prop.coordenadas.lng
            );
            distancias.set(prop.id ?? '', distancia);
          }
        });
      }
    }

    // Calcular score para cada propiedad
    const propertiesWithScore: PropertyWithScore[] = filteredProperties.map(property => {
      const distancia = property.id ? distancias.get(property.id) : undefined;
      const { score, reasons } = calculatePropertyScore(property, criterios, distancia);
      const scoreLevel = getScoreLevel(score);

      return {
        ...property,
        score,
        scoreLevel,
        scoreReasons: reasons
      };
    });

    // Ordenar por score descendente
    propertiesWithScore.sort((a, b) => b.score - a.score);

    // Agrupar por nivel de score
    const altas = propertiesWithScore.filter(p => p.scoreLevel === 'alto');
    const medias = propertiesWithScore.filter(p => p.scoreLevel === 'medio');
    const bajas = propertiesWithScore.filter(p => p.scoreLevel === 'bajo');

    return {
      altas,
      medias,
      bajas,
      additionalText: '',
      totalResults: propertiesWithScore.length
    };
  } catch (error) {
    console.error('Error searching properties:', error);
    return {
      altas: [],
      medias: [],
      bajas: [],
      additionalText: 'Error al realizar la búsqueda de propiedades.',
      totalResults: 0
    };
  }
}

/**
 * HYBRID RAG-based property search combining semantic search, proximity, and criteria scoring
 * This function uses:
 * - Hard filter: tipo_operacion (mandatory)
 * - Semantic similarity: 50% weight
 * - Proximity (location): 30% weight with text match bonus
 * - Criteria matching: 20% weight (type, price, rooms)
 */
export async function queryPropertiesRAG(
  uid: string, 
  criterios: SearchPropertiesParams
): Promise<SearchResult> {
  try {
    console.log('[Hybrid RAG Search] Starting hybrid property search');
    console.log('[Hybrid RAG Search] Criterios:', criterios);

    // Format price if exists
    if (criterios.precio) {
      criterios.precio = formatPrice(criterios.precio) as any;
    }

    // STEP 1: Get all properties and apply HARD FILTER (tipo_operacion)
    const allProperties = await getProperties(uid);
    console.log('[Hybrid RAG Search] Total properties:', allProperties.length);

    let filteredProperties = allProperties;
    if (criterios.tipo_operacion) {
      const tipoOperacionBuscado = criterios.tipo_operacion === 'Compra' ? 'Venta' : criterios.tipo_operacion;
      console.log(`[Hybrid RAG Search] Hard filter (${tipoOperacionBuscado}):`, filteredProperties.length);
      console.log(`[Hybrid RAG Search] Filtered properties:`, filteredProperties.map(item => item.tipo_operacion));
      filteredProperties = filteredProperties.filter(item => String(item.tipo_operacion).toLowerCase() === String(tipoOperacionBuscado).toLowerCase());
      console.log(`[Hybrid RAG Search] After hard filter (${tipoOperacionBuscado}):`, filteredProperties.length);
    }

    if (filteredProperties.length === 0) {
      return {
        altas: [],
        medias: [],
        bajas: [],
        additionalText: `No tengo propiedades publicadas para ${criterios.tipo_operacion === 'Compra' ? 'Venta' : criterios.tipo_operacion}.`,
        totalResults: 0
      };
    }

    // STEP 2: Build natural language query from search criteria
    const queryParts: string[] = [];

    if (criterios.tipo_operacion) {
      const operacion = criterios.tipo_operacion === 'Compra' ? 'Venta' : criterios.tipo_operacion;
      queryParts.push(`para ${operacion.toLowerCase()}`);
    }

    if (criterios.tipo_propiedad) {
      queryParts.push(criterios.tipo_propiedad.toLowerCase());
    }

    if (criterios.ubicacion) {
      queryParts.push(`en ${criterios.ubicacion}`);
    }

    if (criterios.ambientes) {
      queryParts.push(`${criterios.ambientes} ambientes`);
    }

    if (criterios.precio) {
      const precioFormateado = formatPrice(criterios.precio);
      if (Array.isArray(precioFormateado)) {
        queryParts.push(`precio entre ${precioFormateado[0]} y ${precioFormateado[1]}`);
      } else {
        queryParts.push(`precio alrededor de ${precioFormateado}`);
      }
    }

    if (criterios.otro) {
      queryParts.push(criterios.otro);
    }

    const naturalQuery = queryParts.join(' ');
    console.log('[Hybrid RAG Search] Natural query:', naturalQuery);

    // STEP 3: Perform RAG semantic retrieval
    const keys = ['properties', uid];
    const ragResults = await retrievalRAG(keys, naturalQuery, 30);
    console.log(`[Hybrid RAG Search] RAG returned ${ragResults.length} results`);

    if (ragResults.length === 0) {
      return {
        altas: [],
        medias: [],
        bajas: [],
        additionalText: `No encontré propiedades con los criterios que buscás.`,
        totalResults: 0
      };
    }

    // STEP 4: Geocode location if provided for proximity calculation
    let ubicacionCoordenadas: { lat: number; lng: number } | null = null;
    const distancias = new Map<string, number>();

    if (criterios.ubicacion) {
      ubicacionCoordenadas = await geocodificarDireccion(criterios.ubicacion);

      if (ubicacionCoordenadas) {
        filteredProperties.forEach((prop: any) => {
          if (prop.coordenadas) {
            const distancia = calcularDistancia(
              ubicacionCoordenadas!.lat,
              ubicacionCoordenadas!.lng,
              prop.coordenadas.lat,
              prop.coordenadas.lng
            );
            distancias.set(prop.id ?? '', distancia);
          }
        });
        console.log(`[Hybrid RAG Search] Calculated distances for ${distancias.size} properties`);
      }
    }

    // STEP 5: Create property map from filtered properties (after hard filter)
    const propertiesMap = new Map(filteredProperties.map(p => [p.id, p]));

    // STEP 6: Calculate hybrid scores for RAG results
    const propertiesWithScore: PropertyWithScore[] = ragResults
      .map((ragDoc) => {
        // Extract property ID from metadata
        const propertyId = ragDoc.metadata?.id;
        if (!propertyId) {
          console.warn('[Hybrid RAG Search] RAG document missing property_id:', ragDoc.id);
          return null;
        }

        // Get full property data (must be in filtered properties)
        const property = propertiesMap.get(propertyId);
        if (!property) {
          // Property was filtered out by hard filter
          return null;
        }

        // Get RAG similarity score
        const similarity = ragDoc.similarity ?? 0;

        // Check location text match
        const locationTextMatch = criterios.ubicacion 
          ? checkLocationTextMatch(criterios.ubicacion, property.ubicacion)
          : false;

        // Get distance if available
        const distancia = property.id ? distancias.get(property.id) : undefined;

        // Calculate hybrid score
        const { score, reasons } = calculateHybridScore(
          property,
          similarity,
          criterios,
          distancia,
          locationTextMatch
        );

        const scoreLevel = getScoreLevel(score);

        return {
          ...property,
          score,
          scoreLevel,
          scoreReasons: reasons
        };
      })
      .filter((p): p is PropertyWithScore => p !== null);

    console.log(`[Hybrid RAG Search] Scored ${propertiesWithScore.length} properties`);

    // STEP 7: Sort by score (descending)
    propertiesWithScore.sort((a, b) => b.score - a.score);

    // STEP 8: Group by score level
    const altas = propertiesWithScore.filter(p => p.scoreLevel === 'alto');
    const medias = propertiesWithScore.filter(p => p.scoreLevel === 'medio');
    const bajas = propertiesWithScore.filter(p => p.scoreLevel === 'bajo');

    console.log(`[Hybrid RAG Search] Results: ${altas.length} altas (≥70), ${medias.length} medias (50-69), ${bajas.length} bajas (<50)`);

    return {
      altas,
      medias,
      bajas,
      additionalText: '',
      totalResults: propertiesWithScore.length
    };
  } catch (error) {
    console.error('[Hybrid RAG Search] Error in hybrid RAG search:', error);
    
    // Fallback to traditional search
    console.log('[Hybrid RAG Search] Falling back to traditional search');
    return queryProperties(uid, criterios);
  }
}
