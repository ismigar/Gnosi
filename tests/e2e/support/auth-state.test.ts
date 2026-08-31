import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AuthSetupError,
  authOrigin,
  authStorageStatePath,
  parseAuthProfile,
  readAuthInputs,
  requireSessionCookie,
  sessionStorageEntries,
  type AuthEnvironment,
  type SessionCookie,
} from './auth-state.ts';

const env = {
  GNOSI_TEST_EMAIL: 'tester@example.invalid',
  GNOSI_TEST_PASSWORD: 'synthetic-password-marker',
};
const inputs = readAuthInputs(env);
const payload = {
  id: 'synthetic-user',
  email: env.GNOSI_TEST_EMAIL,
  workspaces: [{ id: 'synthetic-workspace', name: 'Fixture', role: 'viewer' }],
};
const profile = parseAuthProfile(payload);
const cookie: SessionCookie = {
  name: 'gnosi_session', value: 'synthetic-session-marker',
  domain: 'example.invalid', path: '/', httpOnly: true,
};

test('requires both explicit credentials and rejects empty values', () => {
  const missing: AuthEnvironment[] = [
    {}, { GNOSI_TEST_EMAIL: env.GNOSI_TEST_EMAIL },
    { GNOSI_TEST_PASSWORD: env.GNOSI_TEST_PASSWORD },
    { ...env, GNOSI_TEST_EMAIL: '' }, { ...env, GNOSI_TEST_EMAIL: '   ' },
    { ...env, GNOSI_TEST_PASSWORD: '' }, { ...env, GNOSI_TEST_PASSWORD: '   ' },
  ];
  for (const candidate of missing) {
    assert.throws(() => readAuthInputs(candidate), AuthSetupError);
  }
});

test('normalizes selectors but preserves all password characters', () => {
  assert.deepEqual(readAuthInputs({
    GNOSI_TEST_EMAIL: ' Tester@Example.invalid ', GNOSI_TEST_PASSWORD: ' pass with spaces ',
    GNOSI_TEST_WORKSPACE_ID: ' selected ', GNOSI_TEST_VAULT_ID: ' vault ',
  }), {
    email: 'Tester@Example.invalid', password: ' pass with spaces ',
    workspaceId: 'selected', vaultId: 'vault',
  });
  assert.equal(readAuthInputs({ ...env, GNOSI_TEST_WORKSPACE_ID: ' ' }).workspaceId, undefined);
  assert.equal(readAuthInputs({ ...env, GNOSI_TEST_VAULT_ID: '' }).vaultId, undefined);
});

test('refuses debug logging before authentication', () => {
  for (const debug of [{ DEBUG: 'pw:*' }, { PWDEBUG: '1' }, { PWDEBUG: 'console' }]) {
    assert.throws(() => readAuthInputs({ ...env, ...debug }), AuthSetupError);
  }
  assert.doesNotThrow(() => readAuthInputs({ ...env, DEBUG: '', PWDEBUG: '0' }));
});

test('preserves configured HTTP/HTTPS origin without changing ports or selecting a backend', () => {
  assert.equal(authOrigin('http://127.0.0.1:5199/path?query=fixture#fragment'), 'http://127.0.0.1:5199');
  assert.equal(authOrigin('https://localhost:5173'), 'https://localhost:5173');
  assert.equal(authOrigin('http://[::1]:5173/'), 'http://[::1]:5173');
  for (const invalid of [undefined, '', 'relative/path', 'ftp://example.invalid',
    'https://user:synthetic-password-marker@example.invalid', ' http://example.invalid']) {
    assert.throws(() => authOrigin(invalid), AuthSetupError);
  }
});

test('resolves the same storage path for setup and dependent projects without reading existing state', () => {
  const directory = '/synthetic-checkout/tests/e2e';
  assert.equal(authStorageStatePath(undefined, directory), `${directory}/tests/.auth/state.json`);
  assert.equal(authStorageStatePath('', directory), `${directory}/tests/.auth/state.json`);
  assert.equal(authStorageStatePath('/synthetic-validation/auth/session.json', directory), '/synthetic-validation/auth/session.json');
  assert.equal(authStorageStatePath('temporary state/session.json', directory), `${directory}/temporary state/session.json`);
});

test('validates unknown profile fields and every membership without coercion or fallback', () => {
  const invalid: unknown[] = [
    null, undefined, [], 'profile', 1, {},
    { ...payload, id: '' }, { ...payload, id: 1 }, { ...payload, id: ' user ' },
    { ...payload, email: null }, { ...payload, email: '' },
    { ...payload, workspaces: null }, { ...payload, workspaces: {} },
    { ...payload, workspaces: [null] }, { ...payload, workspaces: [{}] },
    { ...payload, workspaces: [{ id: 'fixture', role: null }] },
    { ...payload, workspaces: [{ id: 'fixture', role: 'ADMIN' }] },
    { ...payload, workspaces: [{ id: 'fixture', role: 'unknown' }] },
    { ...payload, workspaces: [{ id: 1, role: 'viewer' }] },
    { ...payload, workspaces: [{ id: 'fixture', role: 'viewer' }, { id: 'fixture', role: 'admin' }] },
    { ...payload, workspaces: [payload.workspaces[0], { id: 'broken' }] },
  ];
  for (const candidate of invalid) assert.throws(() => parseAuthProfile(candidate), AuthSetupError);
});

test('persists only verified identity, membership and locale; never a default admin or vault', () => {
  assert.deepEqual(sessionStorageEntries(inputs, profile, profile), [
    { name: 'gnosi_user_id', value: payload.id },
    { name: 'gnosi_user_email', value: payload.email },
    { name: 'gnosi_workspace_id', value: 'synthetic-workspace' },
    { name: 'gnosi_role', value: 'viewer' },
    { name: 'i18nextLng', value: 'ca' },
  ]);
  for (const role of ['owner', 'admin', 'editor', 'viewer']) {
    const session = parseAuthProfile({ ...payload, workspaces: [{ id: 'fixture', role }] });
    const stored = sessionStorageEntries(inputs, profile, session);
    assert.equal(stored.find((entry) => entry.name === 'gnosi_role')?.value, role);
  }
});

test('requires an explicit membership when selection is ambiguous; the session role wins', () => {
  const session = parseAuthProfile({ ...payload, workspaces: [
    { id: 'first', role: 'admin' }, { id: 'selected', role: 'viewer' },
  ] });
  assert.throws(() => sessionStorageEntries(inputs, profile, session), AuthSetupError);
  assert.throws(() => sessionStorageEntries({ ...inputs, workspaceId: 'missing' }, profile, session), AuthSetupError);
  const stored = sessionStorageEntries({ ...inputs, workspaceId: 'selected', vaultId: 'fixture-vault' }, profile, session);
  assert.equal(stored.find((entry) => entry.name === 'gnosi_workspace_id')?.value, 'selected');
  assert.equal(stored.find((entry) => entry.name === 'gnosi_role')?.value, 'viewer');
  assert.equal(stored.find((entry) => entry.name === 'gnosi_active_vault')?.value, 'fixture-vault');
  assert.equal(stored.length, 6);
});

test('rejects zero memberships even if a workspace was explicitly requested', () => {
  const session = parseAuthProfile({ ...payload, workspaces: [] });
  assert.throws(() => sessionStorageEntries(inputs, profile, session), AuthSetupError);
  assert.throws(() => sessionStorageEntries({ ...inputs, workspaceId: 'personal' }, profile, session), AuthSetupError);
});

test('compares login and session identity, with backend-compatible email case normalization', () => {
  const mixedCase = parseAuthProfile({ ...payload, email: 'Tester@Example.invalid' });
  assert.doesNotThrow(() => sessionStorageEntries(inputs, mixedCase, profile));
  for (const wrong of [
    parseAuthProfile({ ...payload, id: 'different-user' }),
    parseAuthProfile({ ...payload, email: 'different@example.invalid' }),
  ]) {
    assert.throws(() => sessionStorageEntries(inputs, profile, wrong), AuthSetupError);
    assert.throws(() => sessionStorageEntries(inputs, wrong, profile), AuthSetupError);
  }
});

test('requires exactly one nonempty HttpOnly session cookie scoped to the frontend origin', () => {
  assert.doesNotThrow(() => requireSessionCookie([cookie], 'https://example.invalid'));
  assert.doesNotThrow(() => requireSessionCookie([{ ...cookie, domain: '.example.invalid' }], 'https://app.example.invalid'));
  const invalid: SessionCookie[][] = [
    [], [cookie, cookie], [{ ...cookie, name: 'other' }], [{ ...cookie, value: '' }],
    [{ ...cookie, value: ' ' }], [{ ...cookie, httpOnly: false }],
    [{ ...cookie, path: '/elsewhere' }], [{ ...cookie, domain: 'other.invalid' }],
    [{ ...cookie, domain: '' }], [{ ...cookie, domain: 'invalid' }],
  ];
  for (const candidate of invalid) {
    assert.throws(() => requireSessionCookie(candidate, 'https://example.invalid'), AuthSetupError);
  }
  assert.throws(() => requireSessionCookie([cookie], 'https://app.example.invalid'), AuthSetupError);
});

test('validation failures never echo credentials, identity, selectors or session values', () => {
  const marker = 'synthetic-sensitive-marker';
  const failures = [
    () => readAuthInputs({ GNOSI_TEST_PASSWORD: marker }),
    () => authOrigin(`https://user:${marker}@example.invalid`),
    () => parseAuthProfile({ id: marker, email: marker, workspaces: marker }),
    () => sessionStorageEntries({ ...inputs, workspaceId: marker }, profile, profile),
    () => requireSessionCookie([{ ...cookie, value: marker, httpOnly: false }], 'https://example.invalid'),
  ];
  for (const fail of failures) {
    assert.throws(fail, (error: unknown) => {
      assert.ok(error instanceof AuthSetupError);
      assert.ok(!String(error.stack).includes(marker));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});
