import { tool } from 'ai';
import { z } from 'zod';
import type { GuidelineMatch } from '../types/guideline';

// Type helper for tools - use any for now to accept all tool definitions
type ToolDefinitionType = ReturnType<typeof tool<any, any>>;

export interface ToolDefinition {
  name: string;
  description: string;
  tool: ToolDefinitionType;
  associatedGuidelines?: string[]; // IDs of guidelines
}

export class ToolOrchestrator {
  private tools = new Map<string, ToolDefinition>();
  private executionLog: Array<{
    toolName: string;
    guidelineId: string;
    timestamp: Date;
    result: any;
  }> = [];

  // Register tool
  registerTool(toolDef: ToolDefinition): void {
    this.tools.set(toolDef.name, toolDef);
    console.log(`[ToolOrchestrator] Registered tool: ${toolDef.name}`);
  }

  // Register tool from ai-sdk tool format
  registerAiSdkTool(
    name: string,
    description: string,
    aiTool: ToolDefinitionType,
    associatedGuidelines?: string[]
  ): void {
    this.registerTool({
      name,
      description,
      tool: aiTool,
      associatedGuidelines
    });
  }

  // Get tools associated with active guidelines
  getToolsForGuidelines(matches: GuidelineMatch[]): Record<string, ToolDefinitionType> {
    const activeTools: Record<string, ToolDefinitionType> = {};
    const processedTools = new Set<string>();

    console.log(`[ToolOrchestrator] Getting tools for ${matches.length} active guidelines...`);

    // ALWAYS include core tools regardless of active guidelines
    const coreTools = ['get_property_info', 'search_properties'];
    coreTools.forEach(toolName => {
      const toolDef = this.tools.get(toolName);
      if (toolDef) {
        console.log(`[ToolOrchestrator] Adding CORE tool: ${toolName}`);
        activeTools[toolName] = toolDef.tool;
        processedTools.add(toolName);
      }
    });

    matches.forEach(match => {
      const toolNames = match.guideline.tools || [];
      
      toolNames.forEach(toolName => {
        if (processedTools.has(toolName)) return;

        const toolDef = this.tools.get(toolName);
        if (!toolDef) {
          console.warn(`[ToolOrchestrator] Tool ${toolName} not found for guideline ${match.guideline.id}`);
          return;
        }

        console.log(`[ToolOrchestrator] Activating tool: ${toolName} (guideline: ${match.guideline.id})`);

        // Use the tool directly from ai-sdk
        activeTools[toolName] = toolDef.tool;

        processedTools.add(toolName);
      });
    });

    console.log(`[ToolOrchestrator] Activated ${Object.keys(activeTools).length} tools:`, Object.keys(activeTools));

    return activeTools;
  }

  // Log tool execution
  logExecution(toolName: string, guidelineId: string, result: any): void {
    this.executionLog.push({
      toolName,
      guidelineId,
      timestamp: new Date(),
      result
    });
  }

  // Determine if a tool requires re-evaluation of guidelines
  shouldReevaluate(toolName: string): boolean {
    const toolDef = this.tools.get(toolName);
    // Tools with workflow behavior (get_help, ask_availability) should trigger re-evaluation
    const workflowTools = ['get_help', 'ask_availability', 'get_availability'];
    return workflowTools.includes(toolName);
  }

  // Get execution log for analysis
  getExecutionLog(): typeof this.executionLog {
    return [...this.executionLog];
  }

  // Clear old log
  clearLog(olderThanMs: number = 3600000): void {
    const cutoff = Date.now() - olderThanMs;
    this.executionLog = this.executionLog.filter(
      log => log.timestamp.getTime() > cutoff
    );
  }

  // Get registered tool names
  getRegisteredTools(): string[] {
    return Array.from(this.tools.keys());
  }
}

