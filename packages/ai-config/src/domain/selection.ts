export interface SelectionResult {
  provider: string;
  model: string;
  fallbackUsed: boolean;
  reason?: string;
  allowlistApplied?: string[];
  attempted?: Array<{ provider: string; model: string }>;
}
