/**
 * Tool Call Extractor Utilities
 * Extracts and formats tool calls and execution steps from AI SDK responses
 */

// Type definitions for AI SDK responses (compatible with v5.0.99)
interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  args: any;
  result: any;
}

/**
 * Extracted tool call information
 */
export interface ExtractedToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
  result?: any;
}

/**
 * Extracted step information from multi-step generation
 */
export interface ExtractedStep {
  stepType: 'initial' | 'tool-call' | 'tool-result' | 'continue' | 'finish';
  text?: string;
  toolCalls?: ExtractedToolCall[];
  toolResults?: ToolCallResult[];
  finishReason?: string;
}

/**
 * Complete execution history
 */
export interface ExecutionHistory {
  steps: ExtractedStep[];
  allToolCalls: ExtractedToolCall[];
  finalText: string;
  totalSteps: number;
}

/**
 * Extract tool calls from AI SDK response
 */
export function extractToolCalls(response: any): ExtractedToolCall[] {
  const toolCalls: ExtractedToolCall[] = [];

  // Direct tool calls from response
  if (response.toolCalls && Array.isArray(response.toolCalls)) {
    for (const tc of response.toolCalls) {
      toolCalls.push({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: tc.args || {},
      });
    }
  }

  // Tool calls from steps (multi-step execution)
  if (response.steps && Array.isArray(response.steps)) {
    for (const step of response.steps) {
      if (step.toolCalls && Array.isArray(step.toolCalls)) {
        for (const tc of step.toolCalls) {
          toolCalls.push({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.args || {},
          });
        }
      }
    }
  }

  return toolCalls;
}

/**
 * Extract tool results from AI SDK response
 */
export function extractToolResults(response: any): ToolCallResult[] {
  const toolResults: ToolCallResult[] = [];

  if (response.steps && Array.isArray(response.steps)) {
    for (const step of response.steps) {
      if (step.toolResults && Array.isArray(step.toolResults)) {
        toolResults.push(...step.toolResults);
      }
    }
  }

  return toolResults;
}

/**
 * Extract execution steps from AI SDK response
 */
export function extractSteps(response: any): ExtractedStep[] {
  const steps: ExtractedStep[] = [];

  if (!response.steps || !Array.isArray(response.steps)) {
    // No multi-step execution, create single step
    return [
      {
        stepType: 'finish',
        text: response.text || '',
        toolCalls: response.toolCalls ? extractToolCalls(response) : [],
        finishReason: response.finishReason || 'stop',
      },
    ];
  }

  for (const step of response.steps) {
    const extractedStep: ExtractedStep = {
      stepType: determineStepType(step),
      text: step.text || '',
    };

    // Add tool calls if present
    if (step.toolCalls && Array.isArray(step.toolCalls)) {
      extractedStep.toolCalls = step.toolCalls.map((tc: any) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: tc.args || {},
      }));
    }

    // Add tool results if present
    if (step.toolResults && Array.isArray(step.toolResults)) {
      extractedStep.toolResults = step.toolResults;
    }

    // Add finish reason if present
    if (step.finishReason) {
      extractedStep.finishReason = step.finishReason;
    }

    steps.push(extractedStep);
  }

  return steps;
}

/**
 * Determine step type from step properties
 */
function determineStepType(step: any): ExtractedStep['stepType'] {
  if (step.toolCalls && step.toolCalls.length > 0) {
    return 'tool-call';
  }
  if (step.toolResults && step.toolResults.length > 0) {
    return 'tool-result';
  }
  if (step.finishReason) {
    return 'finish';
  }
  if (step.text) {
    return 'continue';
  }
  return 'initial';
}

/**
 * Build complete execution history from response
 */
export function buildExecutionHistory(response: any): ExecutionHistory {
  const steps = extractSteps(response);
  const allToolCalls = extractToolCalls(response);
  
  return {
    steps,
    allToolCalls,
    finalText: response.text || '',
    totalSteps: steps.length,
  };
}

/**
 * Format tool calls for logging/storage
 */
export function formatToolCallsForLog(toolCalls: ExtractedToolCall[]): string {
  if (toolCalls.length === 0) return 'No tool calls';

  return toolCalls
    .map(
      (tc, idx) =>
        `${idx + 1}. ${tc.toolName}(${Object.keys(tc.args).join(', ')})`
    )
    .join('\n');
}

/**
 * Format execution history as markdown for logging
 */
export function formatExecutionHistoryAsMarkdown(history: ExecutionHistory): string {
  let md = `# Execution History (${history.totalSteps} steps)\n\n`;

  for (let i = 0; i < history.steps.length; i++) {
    const step = history.steps[i];
    md += `## Step ${i + 1}: ${step.stepType}\n\n`;

    if (step.text) {
      md += `**Text Output:**\n\`\`\`\n${step.text}\n\`\`\`\n\n`;
    }

    if (step.toolCalls && step.toolCalls.length > 0) {
      md += `**Tool Calls:**\n`;
      for (const tc of step.toolCalls) {
        md += `- ${tc.toolName}(${JSON.stringify(tc.args)})\n`;
      }
      md += '\n';
    }

    if (step.toolResults && step.toolResults.length > 0) {
      md += `**Tool Results:**\n`;
      for (const tr of step.toolResults) {
        md += `- ${tr.toolCallId}: ${typeof tr.result === 'string' ? tr.result.substring(0, 100) : JSON.stringify(tr.result).substring(0, 100)}...\n`;
      }
      md += '\n';
    }

    if (step.finishReason) {
      md += `**Finish Reason:** ${step.finishReason}\n\n`;
    }
  }

  md += `## Final Output\n\n\`\`\`\n${history.finalText}\n\`\`\`\n`;

  return md;
}

/**
 * Extract tool execution summary for conversation history
 */
export function extractToolExecutionSummary(
  response: any
): { toolsExecuted: string[]; hasToolCalls: boolean } {
  const toolCalls = extractToolCalls(response);
  const uniqueTools = [...new Set(toolCalls.map(tc => tc.toolName))];

  return {
    toolsExecuted: uniqueTools,
    hasToolCalls: toolCalls.length > 0,
  };
}

/**
 * Merge tool results with tool calls
 */
export function mergeToolCallsWithResults(
  response: any
): ExtractedToolCall[] {
  const toolCalls = extractToolCalls(response);
  const toolResults = extractToolResults(response);

  // Create a map of results by toolCallId
  const resultsMap = new Map<string, any>();
  for (const result of toolResults) {
    resultsMap.set(result.toolCallId, result.result);
  }

  // Merge results into tool calls
  return toolCalls.map(tc => ({
    ...tc,
    result: resultsMap.get(tc.toolCallId),
  }));
}

// ============================================================================
// New Functions for Message Composer Integration
// ============================================================================

export interface ToolCallResultSimple {
  toolName: string;
  result: any;
}

export interface ToolExecutionRecord {
  iteration: number;
  toolName: string;
  result: any;
  timestamp: string;
}

export interface ExtractedToolData {
  currentResults: ToolCallResultSimple[];
  executionHistory: ToolExecutionRecord[];
}

/**
 * Extracts tool calls and results from AI SDK v5 response steps
 * Handles both Promise and non-Promise steps
 *
 * @param response - The response object from generateText
 * @param iteration - Current iteration number for tracking
 * @returns Object with current results and execution history
 */
export async function extractToolCallsFromSteps(
  response: any,
  iteration: number
): Promise<ExtractedToolData> {
  const currentResults: ToolCallResultSimple[] = [];
  const executionHistory: ToolExecutionRecord[] = [];

  // Debug: log full response structure (first time only)
  if (iteration === 1) {
    console.log(`[ToolCallExtractor] Response keys:`, Object.keys(response));
    console.log(`[ToolCallExtractor] Has steps:`, 'steps' in response);
    console.log(`[ToolCallExtractor] Has toolCalls:`, 'toolCalls' in response);
    console.log(`[ToolCallExtractor] Has toolResults:`, 'toolResults' in response);
  }

  // Handle response structure (AI SDK v5)
  const responseData = 'steps' in response && !('then' in response)
    ? response
    : { steps: [], text: response.text };

  // Await steps if they are a Promise
  const steps = responseData.steps instanceof Promise
    ? await responseData.steps
    : responseData.steps;

  // Process steps if available
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    console.log(`[ToolCallExtractor] No steps found in response, checking direct properties`);

    // Try to extract from direct response properties
    if (response.toolCalls && Array.isArray(response.toolCalls)) {
      console.log(`[ToolCallExtractor] Found ${response.toolCalls.length} direct toolCalls`);

      response.toolCalls.forEach((call: any) => {
        currentResults.push({
          toolName: call.toolName,
          result: call.result ?? call.output
        });

        executionHistory.push({
          iteration,
          toolName: call.toolName,
          result: call.result ?? call.output,
          timestamp: new Date().toISOString()
        });
      });
    }

    return { currentResults, executionHistory };
  }

  // Extract all tool calls and results from steps
  const allToolCalls = steps.flatMap((step: any) => step.toolCalls || []);
  const allToolResults = steps.flatMap((step: any) => step.toolResults || []);

  if (allToolCalls.length === 0) {
    console.log(`[ToolCallExtractor] No tool calls found in steps`);
    return { currentResults, executionHistory };
  }

  console.log(`[ToolCallExtractor] Processing ${allToolCalls.length} tool call(s) from iteration ${iteration}`);
  console.log(`[ToolCallExtractor] Found ${allToolResults.length} tool result(s)`);

  // Debug: log structure of results
  if (allToolResults.length > 0) {
    console.log(`[ToolCallExtractor] Sample result structure:`, {
      keys: Object.keys(allToolResults[0]),
      sample: allToolResults[0]
    });
  }

  // Process each tool call
  allToolCalls.forEach((call: any) => {
    console.log(`[ToolCallExtractor]   - ${call.toolName} (callId: ${call.toolCallId})`);

    // Find corresponding result by toolCallId
    const matchingResult = allToolResults.find(
      (r: any) => r.toolCallId === call.toolCallId
    );

    // Extract result - it might be in different properties depending on SDK version
    let resultValue = undefined;
    if (matchingResult) {
      // Try different possible properties where result might be stored
      resultValue = matchingResult.result ?? matchingResult.output ?? matchingResult.value ?? matchingResult;

      // Parse JSON strings to objects for better validation
      if (typeof resultValue === 'string') {
        try {
          const parsed = JSON.parse(resultValue);
          resultValue = parsed;
          console.log(`[ToolCallExtractor]     ✓ Result found and parsed for ${call.toolName}`);
        } catch (e) {
          // Keep as string if not valid JSON
          console.log(`[ToolCallExtractor]     ✓ Result found for ${call.toolName} (string, not JSON)`);
        }
      } else {
        console.log(`[ToolCallExtractor]     ✓ Result found for ${call.toolName}:`, typeof resultValue);
      }
    } else {
      console.log(`[ToolCallExtractor]     ✗ No result found for ${call.toolName}`);
    }

    const toolResult: ToolCallResultSimple = {
      toolName: call.toolName,
      result: resultValue
    };

    // Add to current iteration results
    currentResults.push(toolResult);

    // Add to execution history with metadata
    executionHistory.push({
      iteration,
      toolName: call.toolName,
      result: resultValue,
      timestamp: new Date().toISOString()
    });
  });

  console.log(`[ToolCallExtractor] Extracted ${currentResults.length} tool result(s)`);

  return { currentResults, executionHistory };
}

/**
 * Merges execution history from multiple iterations
 *
 * @param existingHistory - Existing execution history
 * @param newHistory - New history to merge
 * @returns Merged execution history
 */
export function mergeExecutionHistory(
  existingHistory: ToolExecutionRecord[],
  newHistory: ToolExecutionRecord[]
): ToolExecutionRecord[] {
  return [...existingHistory, ...newHistory];
}
