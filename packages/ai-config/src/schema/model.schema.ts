// Esquema de validación para Model
import { z } from 'zod';

export const ModelCompatSchema = z.object({
  context: z.array(z.string()),
  reasoning: z.array(z.string()),
  tools: z.array(z.string()),
  transport: z.array(z.string()),
});

export const ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerId: z.string().optional(),
  compat: ModelCompatSchema,
  meta: z.record(z.string(), z.unknown()).optional(),
});
