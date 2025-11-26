/**
 * Temporal Block Manager
 * Manages temporary blocks for user conversations to prevent bot interference
 * when human agents are handling conversations
 */

/**
 * Configuration for temporal blocks
 */
export const TEMPORAL_BLOCK_CONFIG = {
  // Duration in milliseconds when human continues conversation
  HUMAN_INTERVENTION_DURATION: 2 * 60 * 1000, // 2 minutes
  // Indefinite block value
  INDEFINITE_BLOCK: -1,
} as const;

/**
 * State management for temporal blocks
 */
class TemporalBlockManager {
  private timers: Map<string, NodeJS.Timeout | boolean> = new Map();

  /**
   * Sets a temporal block for a conversation key
   * @param key - Conversation key (e.g., "session:phone")
   * @param durationMs - Duration in milliseconds, or negative for indefinite
   */
  setBlock(key: string, durationMs: number): void {
    // Clear existing timer if present
    const currentTimer = this.timers.get(key);
    if (currentTimer && typeof currentTimer !== 'boolean') {
      clearTimeout(currentTimer);
    }

    // Set indefinite block
    if (durationMs < 0) {
      this.timers.set(key, true);
      console.log(`[TemporalBlock] Indefinite block set for: ${key}`);
      return;
    }

    // Set timed block
    const timer = setTimeout(() => {
      this.timers.delete(key);
      console.log(`[TemporalBlock] Block expired for: ${key}`);
    }, durationMs);

    this.timers.set(key, timer);
    console.log(`[TemporalBlock] Block set for ${durationMs}ms: ${key}`);
  }

  /**
   * Checks if a conversation is currently blocked
   * @param key - Conversation key to check
   * @returns true if blocked, false otherwise
   */
  isBlocked(key: string): boolean {
    return this.timers.has(key);
  }

  /**
   * Manually removes a block
   * @param key - Conversation key to unblock
   */
  removeBlock(key: string): void {
    const timer = this.timers.get(key);
    if (timer && typeof timer !== 'boolean') {
      clearTimeout(timer);
    }
    this.timers.delete(key);
    console.log(`[TemporalBlock] Block removed for: ${key}`);
  }

  /**
   * Gets all currently blocked conversation keys
   * @returns Array of blocked keys
   */
  getBlockedKeys(): string[] {
    return Array.from(this.timers.keys());
  }

  /**
   * Clears all blocks
   */
  clearAllBlocks(): void {
    for (const [key, timer] of this.timers.entries()) {
      if (timer && typeof timer !== 'boolean') {
        clearTimeout(timer);
      }
    }
    this.timers.clear();
    console.log('[TemporalBlock] All blocks cleared');
  }
}

// Singleton instance
export const temporalBlockManager = new TemporalBlockManager();

/**
 * Helper function to build conversation key
 * @param session - Session ID
 * @param customerNumber - Customer phone number
 * @returns Formatted conversation key
 */
export function buildConversationKey(session: string, customerNumber: string): string {
  return `${session}:${customerNumber}`;
}
