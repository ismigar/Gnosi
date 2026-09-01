import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';

import type { APIRequestContext } from '@playwright/test';

import {
  AuthSetupError,
  authOrigin,
  parseAuthProfile,
  readAuthInputs,
  requireSessionCookie,
  sessionStorageEntries,
  type AuthEnvironment,
  type AuthProfile,
} from './auth-state.ts';

export type AuthStorageState = Awaited<ReturnType<APIRequestContext['storageState']>>;

interface AuthResponse {
  status(): number;
  json(): Promise<unknown>;
}

interface RequestOptions {
  failOnStatusCode: false;
  maxRedirects: 0;
  timeout: number;
}

/** Structural boundary: real Playwright requests in setup, deterministic doubles in Node tests. */
export interface AuthRequestClient {
  post(url: string, options: RequestOptions & { data: { email: string; password: string } }): Promise<AuthResponse>;
  get(url: string, options: RequestOptions): Promise<AuthResponse>;
  storageState(): Promise<AuthStorageState>;
  dispose(): Promise<void>;
}

export interface AuthContextOptions {
  baseURL: string;
  ignoreHTTPSErrors: boolean;
  storageState: { cookies: []; origins: [] };
}

type CreateAuthClient = (options: AuthContextOptions) => Promise<AuthRequestClient>;

async function safeOperation<T>(operation: () => Promise<T>, message: string): Promise<T> {
  try {
    return await operation();
  } catch {
    // Do not retain a cause: transport errors can contain request cookies or bodies.
    throw new AuthSetupError(message);
  }
}

async function responseProfile(response: AuthResponse, endpoint: 'login' | 'auth/me'): Promise<AuthProfile> {
  if (response.status() !== 200) {
    throw new AuthSetupError(
      endpoint === 'login'
        ? 'E2E login failed. Check the disposable account and target service; setup never provisions accounts.'
        : 'Session verification through auth/me failed.',
    );
  }
  const payload: unknown = await safeOperation(
    () => response.json(), 'Authentication returned unreadable JSON.',
  );
  return parseAuthProfile(payload);
}

export async function authenticateForStorage(
  env: AuthEnvironment,
  baseURL: string | undefined,
  ignoreHTTPSErrors: boolean,
  createClient: CreateAuthClient,
): Promise<AuthStorageState> {
  // Preflight must precede even client creation. Never reuse a saved session.
  const inputs = readAuthInputs(env);
  const origin = authOrigin(baseURL);
  const client = await safeOperation(() => createClient({
    baseURL: origin,
    ignoreHTTPSErrors,
    storageState: { cookies: [], origins: [] },
  }), 'Unable to create the isolated E2E authentication client.');
  const options: RequestOptions = { failOnStatusCode: false, maxRedirects: 0, timeout: 15_000 };
  try {
    const login = await responseProfile(await safeOperation(() => client.post('/api/auth/login', {
      ...options,
      data: { email: inputs.email, password: inputs.password },
    }), 'Unable to complete the E2E login request.'), 'login');
    const loginState = await safeOperation(
      () => client.storageState(), 'Unable to inspect the login session cookie.',
    );
    requireSessionCookie(loginState.cookies, origin);
    const session = await responseProfile(await safeOperation(
      () => client.get('/api/auth/me', options), 'Unable to verify the E2E session.',
    ), 'auth/me');
    const localStorage = sessionStorageEntries(inputs, login, session);
    const state = await safeOperation(
      () => client.storageState(), 'Unable to capture the verified E2E session.',
    );
    requireSessionCookie(state.cookies, origin);
    return { cookies: state.cookies, origins: [{ origin, localStorage }] };
  } finally {
    await safeOperation(() => client.dispose(), 'Unable to close the E2E authentication client.');
  }
}

export async function saveAuthStorageState(destination: string, state: AuthStorageState): Promise<void> {
  await safeOperation(async () => {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const file = await open(
      destination, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600,
    );
    try {
      // Restrict an existing destination before any session bytes are written.
      await file.chmod(0o600);
      await file.truncate(0);
      await file.writeFile(JSON.stringify(state));
    } finally {
      await file.close();
    }
  }, 'Unable to save the verified E2E storage state. Check the auth output directory permissions.');
}
