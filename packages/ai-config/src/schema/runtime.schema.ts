import { z } from 'zod';
import { ProviderSchema } from './provider.schema.js';
import { ModelSchema } from './model.schema.js';

const ContextDefaultSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  fallback: z.string().optional(),
});

export const RuntimeConfigSchema = z.object({
  mode: z.enum(['merge', 'replace']).default('replace'),
  providers: z.array(ProviderSchema).default([]),
  models: z.array(ModelSchema).default([]),
  profiles: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  allowlist: z.array(z.string()).default([]),
  defaults: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
      byContext: z.record(z.string(), ContextDefaultSchema).default({}),
    })
    .default({ byContext: {} }),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
