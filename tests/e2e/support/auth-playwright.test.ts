import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  authenticateForStorage,
  saveAuthStorageState,
  type AuthContextOptions,
  type AuthRequestClient,
  type AuthStorageState,
} from './auth-playwright.ts';
import { AuthSetupError } from './auth-state.ts';

const env = { GNOSI_TEST_EMAIL: 'tester@example.invalid', GNOSI_TEST_PASSWORD: 'synthetic-password-marker' };
const baseURL = 'http://example.invalid:5199/path';
const profile = {
  id: 'synthetic-user', email: env.GNOSI_TEST_EMAIL,
  workspaces: [{ id: 'synthetic-workspace', role: 'viewer' }],
};
const cookie = {
  name: 'gnosi_session', value: 'synthetic-cookie-marker', domain: 'example.invalid',
  path: '/', httpOnly: true, secure: false, sameSite: 'Lax' as const, expires: -1,
};

interface FixtureOptions {
  loginStatus?: number;
  sessionStatus?: number;
  loginPayload?: unknown;
  sessionPayload?: unknown;
  cookies?: AuthStorageState['cookies'];
  finalCookies?: AuthStorageState['cookies'];
  failAt?: 'create' | 'post' | 'get' | 'state' | 'dispose' | 'json';
}

function fixture(options: FixtureOptions = {}) {
  const calls: string[] = [];
  let contextOptions: AuthContextOptions | undefined;
  let postOptions: Parameters<AuthRequestClient['post']>[1] | undefined;
  let getOptions: Parameters<AuthRequestClient['get']>[1] | undefined;
  let stateReads = 0;
  const rawFailure = () => {
    throw new Error(`${env.GNOSI_TEST_PASSWORD} ${cookie.value}`);
  };
  const response = (status: number, value: unknown) => ({
    status: () => status,
    json: async (): Promise<unknown> => {
      calls.push('json');
      if (options.failAt === 'json') rawFailure();
      return value;
    },
  });
  const client: AuthRequestClient = {
    post: async (url, requestOptions) => {
      calls.push(`POST ${url}`);
      postOptions = requestOptions;
      if (options.failAt === 'post') rawFailure();
      return response(options.loginStatus ?? 200,
        'loginPayload' in options ? options.loginPayload : profile);
    },
    get: async (url, requestOptions) => {
      calls.push(`GET ${url}`);
      getOptions = requestOptions;
      if (options.failAt === 'get') rawFailure();
      return response(options.sessionStatus ?? 200,
        'sessionPayload' in options ? options.sessionPayload : profile);
    },
    storageState: async () => {
      calls.push('state');
      if (options.failAt === 'state') rawFailure();
      stateReads += 1;
      return {
        cookies: stateReads > 1
          ? options.finalCookies ?? options.cookies ?? [cookie]
          : options.cookies ?? [cookie],
        // The adapter must not copy unrelated localStorage from a response.
        origins: [{ origin: 'https://other.invalid', localStorage: [{ name: 'unrelated', value: 'fixture' }] }],
      };
    },
    dispose: async () => {
      calls.push('dispose');
      if (options.failAt === 'dispose') rawFailure();
    },
  };
  return {
    calls,
    requestOptions: () => ({ contextOptions, postOptions, getOptions }),
    create: async (requestOptions: AuthContextOptions) => {
      calls.push('create');
      contextOptions = requestOptions;
      if (options.failAt === 'create') rawFailure();
      return client;
    },
  };
}

async function assertSafeFailure(operation: () => Promise<unknown>): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof AuthSetupError);
    assert.ok(!String(error.stack).includes(env.GNOSI_TEST_PASSWORD));
    assert.ok(!String(error.stack).includes(cookie.value));
    assert.equal(error.cause, undefined);
    return true;
  });
}

test('missing credentials, debug logging and invalid URLs fail before client creation or networking', async () => {
  const fake = fixture();
  for (const candidate of [{}, { GNOSI_TEST_EMAIL: env.GNOSI_TEST_EMAIL },
    { GNOSI_TEST_PASSWORD: env.GNOSI_TEST_PASSWORD }, { ...env, GNOSI_TEST_EMAIL: ' ' },
    { ...env, GNOSI_TEST_PASSWORD: ' ' }, { ...env, DEBUG: 'pw:api' }, { ...env, PWDEBUG: '1' }]) {
    await assertSafeFailure(() => authenticateForStorage(candidate, baseURL, false, fake.create));
  }
  await assertSafeFailure(() => authenticateForStorage(env, undefined, false, fake.create));
  await assertSafeFailure(() => authenticateForStorage(env, 'file:///fixture', false, fake.create));
  assert.deepEqual(fake.calls, []);
});

test('uses only real login and auth/me contracts, a fresh cookie jar and bounded redirect-free requests', async () => {
  const fake = fixture();
  const state = await authenticateForStorage(env, baseURL, true, fake.create);
  assert.deepEqual(fake.calls, [
    'create', 'POST /api/auth/login', 'json', 'state', 'GET /api/auth/me', 'json', 'state', 'dispose',
  ]);
  assert.deepEqual(fake.requestOptions(), {
    contextOptions: { baseURL: 'http://example.invalid:5199', ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } },
    postOptions: {
      failOnStatusCode: false, maxRedirects: 0, timeout: 15_000,
      data: { email: env.GNOSI_TEST_EMAIL, password: env.GNOSI_TEST_PASSWORD },
    },
    getOptions: { failOnStatusCode: false, maxRedirects: 0, timeout: 15_000 },
  });
  assert.deepEqual(state.cookies, [cookie]);
  assert.equal(state.origins.length, 1);
  assert.equal(state.origins[0]?.origin, 'http://example.invalid:5199');
  const values = Object.fromEntries(state.origins[0]!.localStorage.map(({ name, value }) => [name, value]));
  assert.deepEqual(values, {
    gnosi_user_id: profile.id, gnosi_user_email: profile.email,
    gnosi_workspace_id: 'synthetic-workspace', gnosi_role: 'viewer', i18nextLng: 'ca',
  });
  assert.ok(!JSON.stringify(state).includes(env.GNOSI_TEST_PASSWORD));
});

test('preserves explicit membership and optional vault without inventing permissions', async () => {
  const fake = fixture({ sessionPayload: { ...profile, workspaces: [
    { id: 'first', role: 'admin' }, { id: 'chosen', role: 'editor' },
  ] } });
  const state = await authenticateForStorage({
    ...env, GNOSI_TEST_WORKSPACE_ID: 'chosen', GNOSI_TEST_VAULT_ID: 'fixture-vault',
  }, baseURL, false, fake.create);
  const entries = state.origins[0]!.localStorage;
  assert.equal(entries.find(({ name }) => name === 'gnosi_workspace_id')?.value, 'chosen');
  assert.equal(entries.find(({ name }) => name === 'gnosi_role')?.value, 'editor');
  assert.equal(entries.find(({ name }) => name === 'gnosi_active_vault')?.value, 'fixture-vault');
  assert.equal(entries.length, 6);
});

test('refuses HTTP errors and redirects without parsing potentially sensitive response bodies', async () => {
  for (const status of [201, 204, 302, 307, 401, 403, 422, 500]) {
    const fake = fixture({ loginStatus: status });
    await assertSafeFailure(() => authenticateForStorage(env, baseURL, false, fake.create));
    assert.deepEqual(fake.calls, ['create', 'POST /api/auth/login', 'dispose']);
  }
  for (const status of [302, 401, 500]) {
    const fake = fixture({ sessionStatus: status });
    await assertSafeFailure(() => authenticateForStorage(env, baseURL, false, fake.create));
    assert.deepEqual(fake.calls, ['create', 'POST /api/auth/login', 'json', 'state', 'GET /api/auth/me', 'dispose']);
  }
});

test('rejects a missing or script-readable cookie before checking auth/me', async () => {
  for (const cookies of [[], [{ ...cookie, httpOnly: false }], [{ ...cookie, domain: 'other.invalid' }]]) {
    const fake = fixture({ cookies });
    await assertSafeFailure(() => authenticateForStorage(env, baseURL, false, fake.create));
    assert.deepEqual(fake.calls, ['create', 'POST /api/auth/login', 'json', 'state', 'dispose']);
  }
});

test('rechecks cookie persistence after auth/me and never returns a missing final session', async () => {
  const fake = fixture({ finalCookies: [] });
  await assertSafeFailure(() => authenticateForStorage(env, baseURL, false, fake.create));
  assert.equal(fake.calls.filter((call) => call === 'state').length, 2);
  assert.equal(fake.calls.at(-1), 'dispose');
});

test('rejects malformed profiles, mismatched identity and unusable memberships without saving state', async () => {
  const candidates: FixtureOptions[] = [
    { loginPayload: null }, { sessionPayload: null },
    { sessionPayload: { ...profile, id: 'different-user' } },
    { loginPayload: { ...profile, email: 'different@example.invalid' } },
    { sessionPayload: { ...profile, email: 'different@example.invalid' } },
    { sessionPayload: { ...profile, workspaces: [] } },
    { sessionPayload: { ...profile, workspaces: [{ id: 'a', role: 'viewer' }, { id: 'b', role: 'admin' }] } },
    { sessionPayload: { ...profile, workspaces: [{ id: 'a' }] } },
  ];
  for (const options of candidates) {
    const fake = fixture(options);
    await assertSafeFailure(() => authenticateForStorage(env, baseURL, false, fake.create));
    assert.equal(fake.calls.at(-1), 'dispose');
    assert.ok(fake.calls.filter((call) => call === 'state').length < 2);
  }
});

test('sanitizes transport, JSON, cookie inspection, client creation and cleanup errors', async () => {
  const failures: FixtureOptions['failAt'][] = ['create', 'post', 'get', 'state', 'json', 'dispose'];
  for (const failAt of failures) {
    const fake = fixture({ failAt });
    await assertSafeFailure(() => authenticateForStorage(env, baseURL, false, fake.create));
    if (failAt === 'create') assert.deepEqual(fake.calls, ['create']);
    else assert.equal(fake.calls.at(-1), 'dispose');
  }
});

test('writes only the selected synthetic output and enforces mode 600 for new and existing files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gnosi-auth-storage-test-'));
  try {
    const destination = path.join(directory, 'nested', 'state.json');
    const state = await authenticateForStorage(env, baseURL, false, fixture().create);
    await saveAuthStorageState(destination, state);
    assert.equal((await stat(destination)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), state);
    await chmod(destination, 0o644);
    await writeFile(destination, 'synthetic obsolete content that must be truncated'.repeat(100));
    await saveAuthStorageState(destination, state);
    assert.equal((await stat(destination)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), state);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects symlink destinations and sanitizes filesystem failures without changing the linked fixture', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gnosi-auth-storage-test-'));
  try {
    const target = path.join(directory, 'protected-fixture.json');
    const destination = path.join(directory, 'linked-output.json');
    const original = 'synthetic existing state';
    await writeFile(target, original, { mode: 0o600 });
    await symlink(target, destination);
    const state = await authenticateForStorage(env, baseURL, false, fixture().create);
    await assertSafeFailure(() => saveAuthStorageState(destination, state));
    assert.equal(await readFile(target, 'utf8'), original);
    await assertSafeFailure(() => saveAuthStorageState(directory, state));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
