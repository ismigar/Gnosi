import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    changeCurrentPassword,
    fetchCurrentAuthUser,
    loginWithPassword,
    logoutCurrentUser,
    parseAuthUser,
    registerWithPassword,
    updateCurrentAuthUser,
} from './auth';

afterEach(() => {
    vi.unstubAllGlobals();
});

const USER_PAYLOAD = {
    avatar_url: null,
    email: 'member@example.test',
    id: 'user-1',
    name: 'Member',
    workspaces: [{ id: 'workspace-1', name: 'Research', role: 'editor' }],
};

function requestFrom(request: RequestInfo | URL | undefined): Request {
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    return request;
}

describe('authentication API', () => {
    it('validates the legacy untyped user response at the shared boundary', () => {
        expect(parseAuthUser(USER_PAYLOAD)).toEqual(USER_PAYLOAD);
        expect(() => parseAuthUser({ email: 'missing-id@example.test' }))
            .toThrow('without an id');
        expect(parseAuthUser({
            ...USER_PAYLOAD,
            workspaces: [{ id: 'workspace-1' }, USER_PAYLOAD.workspaces[0]],
        }).workspaces).toEqual(USER_PAYLOAD.workspaces);
    });

    it('preserves login, registration, profile, and session request contracts', async () => {
        const fetchMock = vi.fn<typeof fetch>(() => (
            Promise.resolve(Response.json(USER_PAYLOAD, { status: 200 }))
        ));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchCurrentAuthUser()).resolves.toEqual(USER_PAYLOAD);
        await expect(loginWithPassword({
            email: USER_PAYLOAD.email,
            password: 'password-1',
        })).resolves.toEqual(USER_PAYLOAD);
        await expect(registerWithPassword({
            email: USER_PAYLOAD.email,
            name: USER_PAYLOAD.name,
            password: 'password-1',
        })).resolves.toEqual(USER_PAYLOAD);
        await expect(updateCurrentAuthUser({ name: 'Updated' }))
            .resolves.toEqual(USER_PAYLOAD);

        expect(requestFrom(fetchMock.mock.calls[0]?.[0]).method).toBe('GET');
        expect(new URL(requestFrom(fetchMock.mock.calls[0]?.[0]).url).pathname)
            .toBe('/api/auth/me');
        await expect(requestFrom(fetchMock.mock.calls[1]?.[0]).clone().json()).resolves.toEqual({
            email: USER_PAYLOAD.email,
            password: 'password-1',
        });
        expect(new URL(requestFrom(fetchMock.mock.calls[2]?.[0]).url).pathname)
            .toBe('/api/auth/register');
        expect(requestFrom(fetchMock.mock.calls[3]?.[0]).method).toBe('PATCH');
    });

    it('preserves password rotation and idempotent logout without requiring bodies', async () => {
        const fetchMock = vi.fn<typeof fetch>(() => (
            Promise.resolve(Response.json({ ok: true }, { status: 200 }))
        ));
        vi.stubGlobal('fetch', fetchMock);

        await expect(changeCurrentPassword({
            current_password: 'old-password',
            new_password: 'new-password',
        })).resolves.toBeUndefined();
        await expect(logoutCurrentUser()).resolves.toBeUndefined();

        await expect(requestFrom(fetchMock.mock.calls[0]?.[0]).clone().json()).resolves.toEqual({
            current_password: 'old-password',
            new_password: 'new-password',
        });
        expect(new URL(requestFrom(fetchMock.mock.calls[1]?.[0]).url).pathname)
            .toBe('/api/auth/logout');
    });
});
