# Sistema de Guidelines para Agente Inmobiliario

Sistema completo de guidelines implementado con ai-sdk y TypeScript para el agente MultimaiBot.

## 📁 Estructura

```
src/lib/ai/
├── core/
│   ├── glossary-store.ts       # Gestión de terminología inmobiliaria
│   ├── guideline-matcher.ts    # Motor de matching semántico
│   ├── tool-orchestrator.ts    # Orquestación de tools
│   └── message-composer.ts     # Generación de respuestas
├── types/
│   ├── guideline.ts            # Tipos de guidelines
│   └── context.ts              # Tipos de contexto conversacional
├── guidelines/
│   └── multimai-guidelines.ts  # 10 guidelines del agente
├── glossary/
│   └── real-estate-terms.ts    # Glosario de términos inmobiliarios
├── tools/
│   └── index.ts                # Tools del agente (búsqueda, visitas, etc.)
├── workflows/
│   └── main-guidelines-workflow.ts  # Workflow principal
├── guideline-agent.ts          # Clase principal integradora
├── config.ts                   # Configuración de modelos AI
└── index.ts                    # Exports principales
```

## 🚀 Uso Básico

### En el Workflow

```typescript
import { GuidelineAgent } from '@/lib/ai';
import { multimaiGuidelines, realEstateGlossary } from '@/lib/ai';
import { searchPropertiesTool, getTodayDateTool } from '@/lib/ai/tools';

// Crear agente
const agent = new GuidelineAgent(
  multimaiGuidelines,
  realEstateGlossary,
  {
    streaming: false,
    enableCritique: false,
    maxSteps: 3,
    guidelineThreshold: 0.7
  }
);

// Registrar tools
agent.registerTool('search_properties', 'Buscar propiedades', searchPropertiesTool(uid, phone));
agent.registerTool('get_today_date', 'Obtener fecha actual', getTodayDateTool());

// Procesar mensaje
const result = await agent.process(userMessage, conversationContext);
console.log('Response:', result.response);
console.log('Active guidelines:', result.state.activeGuidelines);
```

### Testing

El sistema incluye un endpoint de testing:

```bash
# Ver casos de test disponibles
curl http://localhost:3000/api/test-guidelines

# Probar caso de saludo
curl -X POST http://localhost:3000/api/test-guidelines \
  -H "Content-Type: application/json" \
  -d '{"testCase": "greeting"}'

# Probar búsqueda
curl -X POST http://localhost:3000/api/test-guidelines \
  -H "Content-Type: application/json" \
  -d '{"testCase": "search"}'

# Mensaje personalizado
curl -X POST http://localhost:3000/api/test-guidelines \
  -H "Content-Type: application/json" \
  -d '{"message": "Busco casa en Palermo", "testCase": "custom"}'
```

## 🎯 Guidelines Disponibles

El sistema incluye 11 guidelines predefinidas con 3 niveles de dificultad:

### Low Difficulty (gpt-4o-mini)
1. **greeting** - Saludo inicial y presentación
2. **collect_feedback** - Recopilación de feedback

### Medium Difficulty (gpt-4o-mini)
3. **search_properties** - Búsqueda de propiedades
4. **get_property_detail** - Detalle de propiedad específica
5. **show_interest** - Interés en propiedades

### High Difficulty (o1-mini)
6. **check_visit_availability** - Consulta de disponibilidad
7. **schedule_new_visit** - Programación de visitas
8. **cancel_visit** - Cancelación de visitas
9. **reschedule_visit** - Reprogramación de visitas
10. **get_human_help** - Escalación a humano
11. **handle_selling_inquiry** - Consultas de venta

**Nota**: El modelo se selecciona automáticamente según la dificultad **máxima** de las guidelines activas.

## 🔧 Componentes Principales

### GlossaryStore
Gestiona terminología del dominio inmobiliario, extrae términos relevantes usando LLM.

### GuidelineMatcher
Motor central que evalúa qué guidelines aplican al contexto actual usando matching semántico con GPT-4o.

### ToolOrchestrator
Orquesta la ejecución de tools asociadas a guidelines activas.

### MessageComposer
Genera respuestas finales incorporando guidelines activas, contexto del glosario y resultados de tools. **Selecciona automáticamente el modelo** (gpt-4o-mini o o1-mini) según la dificultad máxima de las guidelines activas.

### GuidelineAgent
Clase principal que integra todos los componentes y ejecuta el flujo completo.

## ⚙️ Configuración

Ver `config.ts` para ajustar:

- Modelos AI para cada componente
- **Modelos por nivel de dificultad** (nuevo)
- Thresholds de matching
- Límites de tokens
- Feature flags (critique, caching, streaming)

```typescript
export const AI_CONFIG = {
  GLOSSARY_MODEL: 'gpt-oss-20b',
  MATCHING_MODEL: 'gemini-2.5-flash-lite',
  COMPOSER_MODEL: 'gpt-4o-mini',         // Default (no se usa si hay difficulty)
  
  // Modelos por dificultad (selección automática)
  COMPOSER_MODEL_LOW: 'gpt-4o-mini',     // Tareas simples
  COMPOSER_MODEL_MEDIUM: 'gpt-4o-mini',  // Tareas estándar
  COMPOSER_MODEL_HIGH: 'o1-mini',        // Tareas complejas ⚡
  
  GUIDELINE_THRESHOLD: 0.8,
  MAX_STEPS: 3,
  ENABLE_CRITIQUE: false,
  ENABLE_CACHING: true,
  // ...
};
```

## 📊 Flujo de Ejecución

1. **Extracción de términos**: GlossaryStore identifica términos relevantes del glosario
2. **Matching de guidelines**: GuidelineMatcher evalúa qué guidelines aplican (threshold: 0.8)
3. **Activación de tools**: ToolOrchestrator prepara tools asociadas a guidelines activas
4. **Selección de modelo**: MessageComposer elige el modelo según dificultad máxima (nuevo ⚡)
5. **Composición y ejecución**: Genera respuesta ejecutando tools si es necesario
6. **Re-evaluación** (opcional): Si tools de workflow fueron ejecutadas, re-evaluar guidelines

## 🔍 Debugging

El sistema incluye logging estructurado en cada paso:

```
[GuidelineAgent] Processing START
[Step 1] Extracting glossary terms...
[GuidelineAgent] Relevant terms: ['visita', 'agendar']
[Step 2] Matching guidelines...
[GuidelineMatcher] Matched 2 guidelines above threshold 0.8
  - schedule_new_visit (priority: 9, difficulty: high, score: 0.95)
  - check_visit_availability (priority: 8, difficulty: high, score: 0.88)
[Step 3] Getting tools for active guidelines...
[ToolOrchestrator] Activated 2 tools: ['create_visit', 'get_availability']
[Step 4] Composing response with AI and tools...
[MessageComposer] Selected model for difficulty 'high': o1-mini  ← 🔥 NUEVO
[MessageComposer] Generating response with 2 active guidelines...
[GuidelineAgent] Tools called: 2
  - get_availability
  - create_visit
[GuidelineAgent] Final response length: 420
[GuidelineAgent] Processing END
```

## 📝 Agregar Nueva Guideline

```typescript
// En guidelines/multimai-guidelines.ts
export const multimaiGuidelines: Guideline[] = [
  // ... guidelines existentes
  {
    id: 'nueva_guideline',
    condition: 'Cuándo aplicar esta guideline',
    action: 'Qué debe hacer el agente',
    priority: 8,
    difficulty: 'medium',   // 👈 NUEVO: 'low', 'medium', or 'high'
    tools: ['tool_name'],   // opcional
    enabled: true,
    scope: 'global',
    tags: ['tag1', 'tag2']
  }
];
```

**Guía para elegir `difficulty`:**
- **`low`**: Saludos, despedidas, feedback simple → gpt-4o-mini
- **`medium`**: Búsquedas, consultas básicas → gpt-4o-mini
- **`high`**: Visitas, escalaciones, razonamiento complejo → o1-mini

## 🛠️ Agregar Nueva Tool

```typescript
// Registrar en el workflow
agent.registerTool(
  'tool_name',
  'Descripción de la tool',
  toolFunction(uid, phone),
  ['guideline_id'] // guidelines asociadas
);
```

## 📈 Métricas

El sistema retorna métricas de ejecución:

```typescript
{
  response: "...",
  state: {
    activeGuidelines: [...],
    glossaryTerms: [...],
    conversationPhase: "discovery"
  },
  executionTrace: [
    { step: 'glossary', terms: [...] },
    { step: 'matching', matched: [...] },
    { step: 'tool_execution', toolCalls: [...] }
  ]
}
```

## 🔒 Consideraciones de Seguridad

- Las tools verifican permisos usando `uid` y `userPhone`
- Los workflow tools (get_help, ask_availability) requieren autenticación
- Cache de matching por sessionId para evitar evaluaciones redundantes

## 🎨 Personalización

### Cambiar threshold de matching
```typescript
const agent = new GuidelineAgent(guidelines, glossary, {
  guidelineThreshold: 0.8 // Más estricto (default: 0.7)
});
```

### Habilitar critique
```typescript
const agent = new GuidelineAgent(guidelines, glossary, {
  enableCritique: true // Verificar adherencia a guidelines
});
```

### Cambiar modelos
```typescript
// En config.ts
export const AI_CONFIG = {
  MATCHING_MODEL: 'gpt-4o-mini', // Más económico
  COMPOSER_MODEL: 'gpt-4o',
  // ...
};
```

## 📚 Referencias

- [Documento original de arquitectura](../../../guideline-system-ai-sdk.md)
- [AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Parlant (inspiración)](https://github.com/emcie-co/parlant)

