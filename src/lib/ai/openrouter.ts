/**
 * OpenRouter Configuration
 * 
 * Centralized configuration for OpenRouter AI provider
 */

import { groq } from '@ai-sdk/groq';
import { openai } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// Create OpenRouter instance
export const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

/**
 * Get OpenRouter model instance
 * @param modelName - The model name (e.g., 'openai/gpt-4-turbo', 'anthropic/claude-3-opus')
 * @returns OpenRouter model instance
 */
export function getOpenRouterModel(modelName: string) {
  return openrouter(modelName, {reasoning: {enabled: true, effort: 'medium'}});
}

export function getModel(modelName: string) {
  return typeof modelName === 'string' && modelName.startsWith('groq/')
    ? groq(modelName.replace('groq/', ''))
    : modelName.startsWith('gpt')
      ? openai(modelName)
      : getOpenRouterModel(modelName);
}
