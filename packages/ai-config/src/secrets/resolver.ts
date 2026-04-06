import type { AuthSource, SecretRef } from '../domain/auth.js';

export interface SecretResolverContext {
  env?: Record<string, string | undefined>;
  profiles?: Record<string, Record<string, string>>;
  profileName?: string;
}

function resolveRef(ref: SecretRef | string, ctx: SecretResolverContext): string | undefined {
  if (typeof ref === 'string') {
    return (ctx.env ?? process.env)[ref];
  }

  if (ref.type === 'env' && ref.name) {
    return (ctx.env ?? process.env)[ref.name];
  }

  if (ref.type === 'file') {
    return undefined;
  }

  if (ref.type === 'exec') {
    return undefined;
  }

  return undefined;
}

export function resolveAuthSecret(
  auth: AuthSource,
  providerId: string,
  context: SecretResolverContext = {},
): AuthSource {
  const env = context.env ?? process.env;
  const profileSecrets = context.profileName ? (context.profiles?.[context.profileName] ?? {}) : {};
  const normalizedProviderId = providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const envKey = `${normalizedProviderId}_API_KEY`;

  const envValue = env[envKey];
  if (envValue) {
    return { ...auth, mode: 'api_key', value: envValue, from: 'env', redacted: true };
  }

  const profileValue = profileSecrets[providerId] ?? profileSecrets[envKey];
  if (profileValue) {
    return { ...auth, mode: 'api_key', value: profileValue, from: 'profile', redacted: true };
  }

  if (auth.ref) {
    const refValue = resolveRef(auth.ref, context);
    if (refValue) {
      return { ...auth, mode: 'api_key', value: refValue, from: 'ref', redacted: true };
    }
  }

  if (auth.value || auth.token) {
    return { ...auth, from: 'config', redacted: true };
  }

  return { ...auth, from: 'config', redacted: false };
}
