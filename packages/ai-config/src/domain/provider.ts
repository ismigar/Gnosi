import type { AuthSource } from './auth.js';

export interface Provider {
  id: string;
  name: string;
  type: string;
  models?: string[];
  auth: AuthSource;
  authEnvVar?: string;
  profileKey?: string;
  priority?: number;
  meta?: Record<string, unknown>;
}
