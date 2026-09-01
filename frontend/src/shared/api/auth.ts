import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { assertApiSuccess, unwrapApiResult } from './errors';

export type AuthLoginInput = components['schemas']['LoginPayload'];
export type AuthRegisterInput = components['schemas']['RegisterPayload'];
export type AuthPasswordChangeInput = components['schemas']['ChangePasswordPayload'];
export type AuthProfileUpdateInput = components['schemas']['UpdateProfilePayload'];

export interface AuthWorkspace {
    readonly id: string;
    readonly name: string;
    readonly role?: string;
}

export interface AuthUser {
    readonly avatar_url?: string | null;
    readonly email: string;
    readonly id: string;
    readonly name?: string | null;
    readonly workspaces: AuthWorkspace[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNullableString(value: unknown): string | null | undefined {
    return value === null || typeof value === 'string' ? value : undefined;
}

function parseWorkspace(value: unknown): AuthWorkspace | null {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
    if (typeof value.name !== 'string' || !value.name) return null;
    const role = typeof value.role === 'string' && value.role ? value.role : undefined;
    return { id: value.id, name: value.name, ...(role ? { role } : {}) };
}

export function parseAuthUser(value: unknown): AuthUser {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id) {
        throw new TypeError('The authentication API returned a user without an id');
    }
    if (typeof value.email !== 'string' || !value.email) {
        throw new TypeError('The authentication API returned a user without an email');
    }
    const rawWorkspaces = Array.isArray(value.workspaces) ? value.workspaces : [];
    const workspaces = rawWorkspaces
        .map(parseWorkspace)
        .filter((workspace): workspace is AuthWorkspace => workspace !== null);
    return {
        id: value.id,
        email: value.email,
        name: optionalNullableString(value.name),
        avatar_url: optionalNullableString(value.avatar_url),
        workspaces,
    };
}

export async function fetchCurrentAuthUser(
    signal?: AbortSignal,
): Promise<AuthUser> {
    return parseAuthUser(unwrapApiResult<unknown, unknown>(
        await apiClient.GET('/api/auth/me', { signal }),
    ));
}

export async function loginWithPassword(
    input: AuthLoginInput,
): Promise<AuthUser> {
    return parseAuthUser(unwrapApiResult<unknown, unknown>(
        await apiClient.POST('/api/auth/login', { body: input }),
    ));
}

export async function registerWithPassword(
    input: AuthRegisterInput,
): Promise<AuthUser> {
    return parseAuthUser(unwrapApiResult<unknown, unknown>(
        await apiClient.POST('/api/auth/register', { body: input }),
    ));
}

export async function updateCurrentAuthUser(
    input: AuthProfileUpdateInput,
): Promise<AuthUser> {
    return parseAuthUser(unwrapApiResult<unknown, unknown>(
        await apiClient.PATCH('/api/auth/me', { body: input }),
    ));
}

export async function changeCurrentPassword(
    input: AuthPasswordChangeInput,
): Promise<void> {
    assertApiSuccess(await apiClient.POST('/api/auth/change-password', { body: input }));
}

export async function logoutCurrentUser(): Promise<void> {
    assertApiSuccess(await apiClient.POST('/api/auth/logout'));
}
