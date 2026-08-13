import { RuntimeConfigSchema, type RuntimeConfig } from '../schema/runtime.schema.js';

export interface LoadConfigOptions {
  env?: Record<string, string | undefined>;
  variables?: Record<string, string>;
}

const VARIABLE_PATTERN = /\$\{([A-Z0-9_]+)\}/gi;

function expandString(input: string, variables: Record<string, string>): string {
  return input.replace(VARIABLE_PATTERN, (_, key: string) => variables[key] ?? `\${{${key}}}`);
}

function deepExpand(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return expandString(value, variables);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepExpand(entry, variables));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepExpand(inner, variables);
    }
    return out;
  }
  return value;
}

export function loadConfig(raw: unknown, options: LoadConfigOptions = {}): RuntimeConfig {
  const vars = {
    ...(Object.fromEntries(
      Object.entries(options.env ?? process.env).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>),
    ...(options.variables ?? {}),
  };
  const expanded = deepExpand(raw, vars);
  return RuntimeConfigSchema.parse(expanded);
}

export function materializeRuntimeConfig(raw: unknown, options: LoadConfigOptions = {}): RuntimeConfig {
  return loadConfig(raw, options);
}
