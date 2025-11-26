/**
 * Ejemplos de uso del sistema de caché con Redis
 */

import { withCache, cacheFn, revalidateTag } from './cache-manager';

// ============================================================================
// EJEMPLO 1: Cachear una función de búsqueda de propiedades
// ============================================================================

interface PropertySearchParams {
  location?: string;
  priceMin?: number;
  priceMax?: number;
  bedrooms?: number;
}

interface Property {
  id: string;
  title: string;
  price: number;
  location: string;
}

// Función original que hace búsqueda en base de datos
async function searchPropertiesOriginal(
  params: PropertySearchParams
): Promise<Property[]> {
  // Simulación de búsqueda en base de datos
  console.log('Ejecutando búsqueda en base de datos...');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return [
    {
      id: '1',
      title: 'Casa en el centro',
      price: 250000,
      location: params.location || 'Ciudad',
    },
  ];
}

// Versión cacheada
export const searchPropertiesCached = withCache(searchPropertiesOriginal, {
  functionName: 'searchProperties',
  ttl: 1800, // 30 minutos
  tags: ['properties', 'search'],
});

// ============================================================================
// EJEMPLO 2: Cachear tool calls del AI SDK
// ============================================================================

interface WeatherData {
  temperature: number;
  condition: string;
  location: string;
}

export async function getWeatherToolCall(location: string): Promise<WeatherData> {
  return cacheFn(
    async (location: string) => {
      console.log('Obteniendo datos del clima desde API...');
      // Simulación de llamada a API externa
      await new Promise((resolve) => setTimeout(resolve, 500));

      return {
        temperature: 22,
        condition: 'Soleado',
        location,
      };
    },
    [location],
    {
      functionName: 'getWeatherToolCall',
      ttl: 300, // 5 minutos - datos de clima cambian frecuentemente
      tags: ['weather', 'tools'],
    }
  );
}

// ============================================================================
// EJEMPLO 3: Cachear resultados de AI con múltiples tags
// ============================================================================

interface AIResponse {
  text: string;
  model: string;
  tokens: number;
}

export async function generateAIResponseCached(
  prompt: string,
  model: string
): Promise<AIResponse> {
  return cacheFn(
    async (prompt: string, model: string) => {
      console.log('Generando respuesta con AI...');
      // Simulación de llamada a AI SDK
      await new Promise((resolve) => setTimeout(resolve, 2000));

      return {
        text: `Respuesta generada para: ${prompt}`,
        model,
        tokens: 150,
      };
    },
    [prompt, model],
    {
      functionName: 'generateAIResponse',
      ttl: 3600, // 1 hora
      tags: ['ai', 'responses', model], // Incluye el modelo como tag
    }
  );
}

// ============================================================================
// EJEMPLO 4: Cachear datos de usuario con revalidación
// ============================================================================

interface User {
  id: string;
  name: string;
  email: string;
}

async function fetchUserFromDB(userId: string): Promise<User | null> {
  console.log('Obteniendo usuario de la base de datos...');
  await new Promise((resolve) => setTimeout(resolve, 800));

  return {
    id: userId,
    name: 'Usuario Ejemplo',
    email: 'usuario@ejemplo.com',
  };
}

export const getUserCached = withCache(fetchUserFromDB, {
  functionName: 'getUser',
  ttl: 600, // 10 minutos
  tags: ['users'],
});

// Función para actualizar usuario (invalida el caché)
export async function updateUser(userId: string, data: Partial<User>): Promise<void> {
  console.log('Actualizando usuario...');
  // Actualizar en base de datos
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Invalidar el caché de usuarios
  await revalidateTag('users');
  console.log('Caché de usuarios invalidado');
}

// ============================================================================
// EJEMPLO 5: Cachear embeddings de documentos
// ============================================================================

interface DocumentEmbedding {
  documentId: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export async function getDocumentEmbeddingCached(
  documentId: string
): Promise<DocumentEmbedding> {
  return cacheFn(
    async (docId: string) => {
      console.log('Generando embedding del documento...');
      // Simulación de generación de embedding (operación costosa)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      return {
        documentId: docId,
        embedding: Array(1536).fill(0).map(() => Math.random()),
        metadata: { createdAt: Date.now() },
      };
    },
    [documentId],
    {
      functionName: 'getDocumentEmbedding',
      ttl: 86400, // 24 horas - embeddings no cambian frecuentemente
      tags: ['embeddings', 'documents'],
      prefix: 'ai-embeddings', // Prefix personalizado
    }
  );
}

// ============================================================================
// EJEMPLO 6: Patrón de múltiples niveles de caché
// ============================================================================

interface ProductData {
  id: string;
  name: string;
  category: string;
}

export async function getProductWithMultiLevelCache(
  productId: string
): Promise<ProductData> {
  // Nivel 1: Caché específico del producto
  const cachedProduct = await cacheFn(
    async (id: string) => {
      console.log('Obteniendo producto de la base de datos...');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return {
        id,
        name: 'Producto Ejemplo',
        category: 'Categoría A',
      };
    },
    [productId],
    {
      functionName: 'getProduct',
      ttl: 3600, // 1 hora
      tags: ['products', `product-${productId}`], // Tag específico + general
    }
  );

  return cachedProduct;
}

// Función para invalidar un producto específico
export async function invalidateProduct(productId: string): Promise<void> {
  await revalidateTag(`product-${productId}`);
}

// Función para invalidar todos los productos
export async function invalidateAllProducts(): Promise<void> {
  await revalidateTag('products');
}

// ============================================================================
// EJEMPLO 7: Uso en un workflow de AI con toolcalls
// ============================================================================

interface ToolCallResult {
  toolName: string;
  result: unknown;
  executedAt: number;
}

export async function executeToolWithCache(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  return cacheFn(
    async (name: string, arguments_: Record<string, unknown>) => {
      console.log(`Ejecutando tool: ${name}`);

      // Simulación de ejecución de tool
      await new Promise((resolve) => setTimeout(resolve, 1000));

      let result: unknown;

      switch (name) {
        case 'search_properties':
          result = await searchPropertiesCached(arguments_ as PropertySearchParams);
          break;
        case 'get_weather':
          result = await getWeatherToolCall(arguments_.location as string);
          break;
        default:
          result = { message: 'Tool no encontrado' };
      }

      return {
        toolName: name,
        result,
        executedAt: Date.now(),
      };
    },
    [toolName, args],
    {
      functionName: 'executeTool',
      ttl: 600, // 10 minutos
      tags: ['tools', toolName], // Tag general + específico del tool
    }
  );
}

// ============================================================================
// EJEMPLO 8: Caché con diferentes TTLs según el tipo de datos
// ============================================================================

type CacheStrategy = 'static' | 'dynamic' | 'realtime';

function getTTLForStrategy(strategy: CacheStrategy): number {
  switch (strategy) {
    case 'static':
      return 86400; // 24 horas
    case 'dynamic':
      return 1800; // 30 minutos
    case 'realtime':
      return 60; // 1 minuto
  }
}

export async function fetchDataWithStrategy<T>(
  key: string,
  fetcher: () => Promise<T>,
  strategy: CacheStrategy,
  tags: string[]
): Promise<T> {
  return cacheFn(
    fetcher,
    [key],
    {
      functionName: `fetchData-${strategy}`,
      ttl: getTTLForStrategy(strategy),
      tags,
    }
  );
}

// Uso:
// const staticData = await fetchDataWithStrategy(
//   'config',
//   () => fetchConfig(),
//   'static',
//   ['config']
// );
