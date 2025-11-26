/**
 * AI Configuration for the Guideline System
 * 
 * Defines models and settings for each component of the guideline agent
 */

export const AI_CONFIG = {
  // Models for each component (OpenRouter format: provider/model-name)
  GLOSSARY_MODEL: 'openai/gpt-4o-mini',      // Extraction of relevant terms (cost-efficient)
  MATCHING_MODEL: 'groq/openai/gpt-oss-120b',// Semantic evaluation (high accuracy)
  // COMPOSER_MODEL: 'openai/gpt-4o-mini',      // Response generation (high quality) - default
  CRITIQUE_MODEL: 'x-ai/grok-4-fast',      // Self-critique (optional, cost-efficient)
  REANKING_MODEL: 'groq/openai/gpt-oss-20b',      // Reranking model (optional, cost-efficient)
  EMBEDDING_MODEL: 'text-embedding-3-small', // Embeddings model
  QUICK_RESPONSE_MODEL: 'groq/openai/gpt-oss-120b', // Quick waiting messages (very fast, cost-efficient)
  CONTEXT_SUMMARY_MODEL: 'groq/openai/gpt-oss-20b', // Context summary generation from logs
  
  // RAG Proposition models
  PROPOSITION_GENERATOR_MODEL: 'groq/openai/gpt-oss-20b',  // Fast proposition generation
  PROPOSITION_VALIDATOR_MODEL: 'groq/openai/gpt-oss-20b',  // Quality and veracity validation
  PROPOSITION_CORRECTOR_MODEL: 'openai/gpt-4o-mini',       // Correction of invalid propositions
  CONTEXT_SEARCH_MODEL: 'groq/openai/gpt-oss-20b',         // Context search agent
  LEAD_QUALIFICATION_MODEL: 'openai/gpt-4o-mini',          // Lead qualification (BANT analysis)
  
  // Models by difficulty level
  COMPOSER_MODEL_LOW: 'openai/gpt-4o-mini',     // Simple tasks (greetings, basic info)
  COMPOSER_MODEL_MEDIUM: 'x-ai/grok-4-fast',  // Standard tasks (searches, basic queries)
  COMPOSER_MODEL_HIGH: 'x-ai/grok-4-fast',   // Complex tasks (scheduling, negotiations, escalations)
  
  // Thresholds and limits
  GUIDELINE_THRESHOLD: 0.6,           // Minimum score to activate guideline
  MAX_STEPS: 3,                       // Maximum iterations in tool execution loop
  MAX_GLOSSARY_TERMS: 5,              // Maximum terms to extract from glossary
  
  // Feature flags
  ENABLE_CRITIQUE: false,             // Self-critique disabled by default
  ENABLE_VALIDATION: true,            // Response validation with critic LLM enabled by default
  ENABLE_CACHING: true,               // Cache matching results
  ENABLE_STREAMING: false,            // Streaming responses disabled by default
  
  // Cache settings
  CACHE_TTL_MS: 3600000,              // Cache time-to-live: 1 hour
  
  // Token limits
  COMPOSER_MAX_TOKENS: 2000,          // Maximum tokens for composer
  GLOSSARY_MAX_TOKENS: 500,           // Maximum tokens for glossary extraction
  
  // Temperature settings
  MATCHING_TEMPERATURE: 0.5,          // Low temperature for consistent matching
  COMPOSER_TEMPERATURE: 1,          // Moderate temperature for natural responses

  // Validation settings
  VALIDATION_MIN_SCORE: 7,            // Minimum score (out of 10) to accept response
  VALIDATION_MAX_RETRIES: 2,          // Maximum retries if validation fails

  // Micro-agents configuration
  ENABLE_MICRO_AGENTS: true,          // Enable micro-agent parallel execution
  MICRO_AGENT_MAX_ITERATIONS: 1,      // Maximum iterations per micro-agent
  MICRO_AGENT_EVALUATION_THRESHOLD: 7.0, // Minimum score to accept micro-agent response
  MICRO_AGENT_TIMEOUT_MS: 30000,      // Timeout for micro-agent execution (30 seconds)

  // Auto-Development Configuration
  AUTO_DEV: {
    // Premium models for auto-development workflows
    ANALYSIS_MODEL: 'openai/gpt-5.1-codex-mini',           // Deep analysis of conversation problems
    VALIDATION_MODEL: 'openai/gpt-5.1-codex-mini',         // Validation of generated solutions
    SYNTHETIC_USER_MODEL: 'openai/gpt-5.1-codex-mini',     // Realistic user simulation
    SOLUTION_GENERATOR_MODEL: 'openai/gpt-5.1-codex-mini', // Solution generation

    // Synthetic conversation generation
    NUM_SYNTHETIC_CONVERSATIONS: 20,      // Number of synthetic conversations to generate
    NUM_REAL_CONVERSATIONS: 100,          // Number of real conversations to fetch
    MIN_CONVERSATIONS_FOR_SYNTHETIC: 10,  // Generate synthetics if real < this threshold

    // Quality thresholds
    SOLUTION_PASS_THRESHOLD: 0.8,        // Minimum pass rate to accept solution (80%)
    MAX_ITERATIONS_PER_PROBLEM: 5,       // Maximum attempts to fix a problem

    // Feature flags
    INCLUDE_SYNTHETIC: true,              // Include synthetic conversations in analysis
    SAVE_SYNTHETIC_TO_FIREBASE: false,    // Save to Firebase (false = temp file)
    USE_PREMIUM_MODELS: true,             // Use premium models for better accuracy
    PARALLEL_GENERATION: 3,               // Number of conversations to generate in parallel
  }
} as const;

export type AIConfig = typeof AI_CONFIG;

// Export individual configs for convenience
export const {
  GLOSSARY_MODEL,
  MATCHING_MODEL,
  // COMPOSER_MODEL,
  COMPOSER_MODEL_LOW,
  COMPOSER_MODEL_MEDIUM,
  COMPOSER_MODEL_HIGH,
  CRITIQUE_MODEL,
  EMBEDDING_MODEL,
  GUIDELINE_THRESHOLD,
  MAX_STEPS,
  MAX_GLOSSARY_TERMS,
  ENABLE_CRITIQUE,
  ENABLE_VALIDATION,
  ENABLE_CACHING,
  ENABLE_STREAMING,
  CACHE_TTL_MS,
  COMPOSER_MAX_TOKENS,
  GLOSSARY_MAX_TOKENS,
  MATCHING_TEMPERATURE,
  COMPOSER_TEMPERATURE,
  VALIDATION_MIN_SCORE,
  VALIDATION_MAX_RETRIES,
  // RAG Proposition models
  PROPOSITION_GENERATOR_MODEL,
  PROPOSITION_VALIDATOR_MODEL,
  PROPOSITION_CORRECTOR_MODEL,
  CONTEXT_SEARCH_MODEL,
} = AI_CONFIG;

