export interface Model {
  id: string;
  name: string;
  providerId?: string;
  compat: ModelCompat;
  meta?: Record<string, unknown>;
}

export interface ModelCompat {
  context: string[];
  reasoning: string[];
  tools: string[];
  transport: string[];
}
