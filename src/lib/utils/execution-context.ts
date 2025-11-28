/**
 * ExecutionContext - Manages execution lifecycle with cancellation support
 * 
 * Features:
 * - Unique executionId for tracking messages
 * - AbortSignal for cancellation detection
 * - Pending actions with deduplication by actionId
 * - Cleanup callback for abort scenarios
 */

import { randomUUID } from 'crypto';

export type PendingActionFn = () => Promise<void>;
export type CleanupFn = (executionId: string) => Promise<void>;

export interface IExecutionContext {
  readonly executionId: string;
  readonly abortSignal: AbortSignal;
  
  isAborted(): boolean;
  addPendingAction(fn: PendingActionFn, actionId?: string): void;
  executePendingActions(): Promise<void>;
  setCleanupFn(fn: CleanupFn): void;
  runCleanup(): Promise<void>;
}

/**
 * ExecutionContext class
 * 
 * Manages the lifecycle of a message processing execution with:
 * - Cancellation support via AbortController
 * - Deferred actions that only execute on successful completion
 * - Deduplication of named actions (same actionId = replace previous)
 * - Cleanup of messages on abort
 */
export class ExecutionContext implements IExecutionContext {
  public readonly executionId: string;
  public readonly abortSignal: AbortSignal;
  
  private readonly abortController: AbortController;
  private namedActions: Map<string, PendingActionFn> = new Map();
  private anonymousActions: PendingActionFn[] = [];
  private cleanupFn: CleanupFn | null = null;
  
  constructor(abortController?: AbortController) {
    this.executionId = randomUUID();
    this.abortController = abortController || new AbortController();
    this.abortSignal = this.abortController.signal;
    
    console.log(`[ExecutionContext] Created with ID: ${this.executionId}`);
  }
  
  /**
   * Check if this execution has been aborted
   */
  isAborted(): boolean {
    return this.abortSignal.aborted;
  }
  
  /**
   * Abort this execution
   */
  abort(): void {
    if (!this.isAborted()) {
      console.log(`[ExecutionContext] Aborting execution ${this.executionId}`);
      this.abortController.abort();
    }
  }
  
  /**
   * Add a pending action to be executed at the end of processing
   * 
   * @param fn - The async function to execute
   * @param actionId - Optional ID for deduplication. If provided and an action
   *                   with the same ID exists, it will be replaced.
   * 
   * Usage:
   * ```typescript
   * // Anonymous action - always added
   * ctx.addPendingAction(async () => { await doSomething(); });
   * 
   * // Named action - replaces previous with same ID
   * ctx.addPendingAction(async () => { await sendMessage("v1"); }, "send_help_123");
   * ctx.addPendingAction(async () => { await sendMessage("v2"); }, "send_help_123");
   * // Only "v2" will be sent
   * ```
   */
  addPendingAction(fn: PendingActionFn, actionId?: string): void {
    if (this.isAborted()) {
      console.log(`[ExecutionContext] Ignoring action - execution already aborted`);
      return;
    }
    
    if (actionId) {
      const isReplacing = this.namedActions.has(actionId);
      this.namedActions.set(actionId, fn);
      console.log(`[ExecutionContext] Action '${actionId}' ${isReplacing ? 'replaced' : 'added'}`);
    } else {
      this.anonymousActions.push(fn);
      console.log(`[ExecutionContext] Anonymous action added (total: ${this.anonymousActions.length})`);
    }
  }
  
  /**
   * Execute all pending actions (only if not aborted)
   * Named actions are executed first, then anonymous actions
   */
  async executePendingActions(): Promise<void> {
    if (this.isAborted()) {
      console.log(`[ExecutionContext] Skipping pending actions - execution was aborted`);
      return;
    }
    
    const totalActions = this.namedActions.size + this.anonymousActions.length;
    if (totalActions === 0) {
      console.log(`[ExecutionContext] No pending actions to execute`);
      return;
    }
    
    console.log(`[ExecutionContext] Executing ${totalActions} pending action(s)`);
    
    // Execute named actions first
    for (const [actionId, fn] of this.namedActions) {
      if (this.isAborted()) {
        console.log(`[ExecutionContext] Aborting mid-execution at action '${actionId}'`);
        return;
      }
      
      try {
        console.log(`[ExecutionContext] Executing named action '${actionId}'`);
        await fn();
      } catch (error) {
        console.error(`[ExecutionContext] Error in action '${actionId}':`, error);
        // Continue with other actions
      }
    }
    
    // Execute anonymous actions
    for (let i = 0; i < this.anonymousActions.length; i++) {
      if (this.isAborted()) {
        console.log(`[ExecutionContext] Aborting mid-execution at anonymous action ${i + 1}`);
        return;
      }
      
      try {
        console.log(`[ExecutionContext] Executing anonymous action ${i + 1}/${this.anonymousActions.length}`);
        await this.anonymousActions[i]();
      } catch (error) {
        console.error(`[ExecutionContext] Error in anonymous action ${i + 1}:`, error);
        // Continue with other actions
      }
    }
    
    console.log(`[ExecutionContext] All pending actions executed`);
  }
  
  /**
   * Set the cleanup function to run on abort
   * This is typically used to delete messages with this executionId
   */
  setCleanupFn(fn: CleanupFn): void {
    this.cleanupFn = fn;
  }
  
  /**
   * Run cleanup (delete messages with this executionId)
   * Only runs if execution was aborted and cleanup function was set
   */
  async runCleanup(): Promise<void> {
    if (!this.isAborted()) {
      console.log(`[ExecutionContext] Skipping cleanup - execution completed successfully`);
      return;
    }
    
    if (!this.cleanupFn) {
      console.log(`[ExecutionContext] No cleanup function set`);
      return;
    }
    
    try {
      console.log(`[ExecutionContext] Running cleanup for execution ${this.executionId}`);
      await this.cleanupFn(this.executionId);
      console.log(`[ExecutionContext] Cleanup completed`);
    } catch (error) {
      console.error(`[ExecutionContext] Error during cleanup:`, error);
    }
  }
  
  /**
   * Clear all pending actions (used when aborting)
   */
  clearPendingActions(): void {
    this.namedActions.clear();
    this.anonymousActions = [];
    console.log(`[ExecutionContext] Pending actions cleared`);
  }
  
  /**
   * Get count of pending actions
   */
  getPendingActionsCount(): number {
    return this.namedActions.size + this.anonymousActions.length;
  }
}

/**
 * Create a new ExecutionContext
 */
export function createExecutionContext(abortController?: AbortController): ExecutionContext {
  return new ExecutionContext(abortController);
}

/**
 * Create a "null" execution context for cases where we don't need cancellation
 * This context never aborts and executes actions immediately (for backward compatibility)
 */
export function createNoOpExecutionContext(): IExecutionContext {
  return {
    executionId: 'no-op',
    abortSignal: new AbortController().signal,
    isAborted: () => false,
    addPendingAction: async (fn: PendingActionFn) => { await fn(); },
    executePendingActions: async () => {},
    setCleanupFn: () => {},
    runCleanup: async () => {},
  };
}

