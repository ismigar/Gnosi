import path from 'node:path';

/** Pure validation for the real authentication setup. Never include input values in errors. */
export type AuthEnvironment = Readonly<Record<string, string | undefined>>;
export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface AuthInputs {
  readonly email: string;
  readonly password: string;
  readonly workspaceId?: string;
  readonly vaultId?: string;
}

export interface AuthMembership {
  readonly id: string;
  readonly role: WorkspaceRole;
}

export interface AuthProfile {
  readonly id: string;
  readonly email: string;
  readonly workspaces: readonly AuthMembership[];
}

export interface StorageEntry {
  name: string;
  value: string;
}

export class AuthSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthSetupError';
  }
}

export function authStorageStatePath(override: string | undefined, e2eDirectory: string): string {
  return path.resolve(e2eDirectory, override || 'tests/.auth/state.json');
}

export function readAuthInputs(env: AuthEnvironment): AuthInputs {
  const email = env.GNOSI_TEST_EMAIL?.trim();
  const password = env.GNOSI_TEST_PASSWORD;
  if (!email || !password?.trim()) {
    throw new AuthSetupError(
      'Set GNOSI_TEST_EMAIL and GNOSI_TEST_PASSWORD for an existing disposable test account before authenticated E2E.',
    );
  }
  // Debug transports can print request headers even when Playwright tracing is off.
  if (env.DEBUG?.trim() || (env.PWDEBUG?.trim() && env.PWDEBUG !== '0')) {
    throw new AuthSetupError('Unset DEBUG and PWDEBUG before authenticated setup.');
  }
  return {
    email,
    password,
    workspaceId: env.GNOSI_TEST_WORKSPACE_ID?.trim() || undefined,
    vaultId: env.GNOSI_TEST_VAULT_ID?.trim() || undefined,
  };
}

export function authOrigin(baseURL: string | undefined): string {
  try {
    if (!baseURL || /\s/.test(baseURL)) throw new Error();
    const url = new URL(baseURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error();
    }
    // Match the existing page.goto('/') contract, including base URLs with a path.
    return url.origin;
  } catch {
    throw new AuthSetupError('Configure an HTTP(S) E2E base URL without embedded credentials or whitespace.');
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer';
}

export function parseAuthProfile(value: unknown): AuthProfile {
  if (!isRecord(value) || !isIdentifier(value.id) || !isIdentifier(value.email)
    || !Array.isArray(value.workspaces)) {
    throw new AuthSetupError('Authentication returned an invalid user profile.');
  }
  const seen = new Set<string>();
  const workspaces = value.workspaces.map((membership: unknown): AuthMembership => {
    if (!isRecord(membership) || !isIdentifier(membership.id)
      || !isWorkspaceRole(membership.role) || seen.has(membership.id)) {
      throw new AuthSetupError('Authentication returned invalid or duplicate workspace memberships.');
    }
    seen.add(membership.id);
    return { id: membership.id, role: membership.role };
  });
  return { id: value.id, email: value.email, workspaces };
}

export function sessionStorageEntries(
  inputs: AuthInputs,
  login: AuthProfile,
  session: AuthProfile,
): StorageEntry[] {
  const expectedEmail = inputs.email.toLowerCase();
  if (login.email.toLowerCase() !== expectedEmail
    || session.email.toLowerCase() !== expectedEmail || login.id !== session.id) {
    throw new AuthSetupError('The verified session does not match the requested login identity.');
  }
  const selected = inputs.workspaceId
    ? session.workspaces.find((membership) => membership.id === inputs.workspaceId)
    : session.workspaces.length === 1 ? session.workspaces[0] : undefined;
  if (!selected) {
    throw new AuthSetupError(
      inputs.workspaceId
        ? 'GNOSI_TEST_WORKSPACE_ID must match a verified session membership.'
        : 'Exactly one verified membership is required unless GNOSI_TEST_WORKSPACE_ID is set.',
    );
  }
  const entries = [
    { name: 'gnosi_user_id', value: session.id },
    { name: 'gnosi_user_email', value: session.email },
    { name: 'gnosi_workspace_id', value: selected.id },
    { name: 'gnosi_role', value: selected.role },
    { name: 'i18nextLng', value: 'ca' },
  ];
  if (inputs.vaultId) entries.push({ name: 'gnosi_active_vault', value: inputs.vaultId });
  return entries;
}

export interface SessionCookie {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: boolean;
  readonly domain: string;
  readonly path: string;
}

export function requireSessionCookie(cookies: readonly SessionCookie[], origin: string): void {
  const sessions = cookies.filter((cookie) => cookie.name === 'gnosi_session');
  const cookie = sessions[0];
  const hostname = new URL(origin).hostname;
  const domain = cookie?.domain.replace(/^\./, '');
  if (sessions.length !== 1 || !cookie?.httpOnly || !cookie.value.trim()
    || cookie.path !== '/' || !domain
    || (hostname !== domain && !(cookie.domain.startsWith('.') && hostname.endsWith(`.${domain}`)))) {
    throw new AuthSetupError('Login must establish an HttpOnly gnosi_session cookie for the selected origin.');
  }
}
