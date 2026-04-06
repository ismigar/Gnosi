// Esquema de validación para Provider
import { z } from 'zod';

export const SecretRefSchema = z.union([
  z.string(),
  z.object({
    type: z.enum(['env', 'file', 'exec']),
    name: z.string().optional(),
    path: z.string().optional(),
    command: z.string().optional(),
  }),
]);

export const AuthSourceSchema = z.object({
  mode: z.enum(['api_key', 'oauth', 'secret_ref']),
  value: z.string().optional(),
  token: z.string().optional(),
  ref: SecretRefSchema.optional(),
});

export const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  models: z.array(z.string()).optional(),
  auth: AuthSourceSchema,
  authEnvVar: z.string().optional(),
  profileKey: z.string().optional(),
  priority: z.number().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
