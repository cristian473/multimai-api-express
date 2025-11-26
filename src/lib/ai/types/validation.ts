export interface ValidationFeedback {
  attempt: number;
  score: number;
  feedback: string;
  issues: string[];
  suggestions: string[];
  toolsToReExecute?: string[];
  previousResponse?: string; // Used for refinement passes
}
