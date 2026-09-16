import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export function googleSignInPath(type: string, email?: string): string {
  const params = new URLSearchParams({ type });
  if (email?.trim()) params.set('login_hint', email.trim());
  return '/api/auth/google/login?' + params.toString();
}


export type GoogleOAuthHealth =
  components['schemas']['GoogleOAuthHealthResponse'];
export type GoogleOAuthStatus =
  components['schemas']['GoogleOAuthStatusResponse'];


export async function fetchGoogleOAuthHealth(
  signal?: AbortSignal,
): Promise<GoogleOAuthHealth> {
  return unwrapApiResult<GoogleOAuthHealth, unknown>(
    await apiClient.GET('/api/auth/google/health', { signal }),
  );
}


export async function fetchGoogleOAuthStatus(
  signal?: AbortSignal,
): Promise<GoogleOAuthStatus> {
  return unwrapApiResult<GoogleOAuthStatus, unknown>(
    await apiClient.GET('/api/auth/google/status', { signal }),
  );
}
