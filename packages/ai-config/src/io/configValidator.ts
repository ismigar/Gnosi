import { RuntimeConfigSchema } from '../schema/runtime.schema.js';

export function validateRuntimeConfig(config: unknown) {
  return RuntimeConfigSchema.parse(config);
}

export function safeValidateRuntimeConfig(config: unknown) {
  const result = RuntimeConfigSchema.safeParse(config);
  if (result.success) {
    return { ok: true as const, data: result.data };
  }
  return {
    ok: false as const,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.map((entry) => String(entry)).join('.'),
      message: issue.message,
    })),
  };
}
