import { afterEach, describe, expect, test, vi } from 'vitest';

import {
    DEFAULT_INTERFACE_LANGUAGE,
    INTERFACE_LANGUAGE_STORAGE_KEY,
    initializeInterfaceLanguage,
    normalizeInterfaceLanguage,
    resolveInitialInterfaceLanguage,
    setInterfaceLanguage,
} from '../src/app/initialization/interfaceLanguage';
import { memoryStorage } from './helpers/memory-storage';
import { queryClient } from '../src/shared/api/query-client';
import { resetApiTestStorage } from './api-request';

afterEach(() => {
    queryClient.clear();
    resetApiTestStorage();
    vi.unstubAllGlobals();
});

describe('interface language resolution', () => {
    test('starts in the configured language without requesting the full configuration', async () => {
        const fetchMock = vi.fn<typeof fetch>((input) => {
            expect(new URL(new Request(input).url).pathname).toBe('/api/config/interface');
            return Promise.resolve(Response.json({ language: 'ca' }));
        });
        vi.stubGlobal('fetch', fetchMock);

        expect(await resolveInitialInterfaceLanguage({ storage: memoryStorage() })).toBe('ca');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    test('normalizes supported regional language tags', () => {
        expect(normalizeInterfaceLanguage('EN-gb')).toBe('en');
        expect(normalizeInterfaceLanguage('ca-AD')).toBe('ca');
        expect(normalizeInterfaceLanguage('de-DE')).toBeNull();
    });

    test('defaults to English without a stored or configured preference', async () => {
        const language = await resolveInitialInterfaceLanguage({
            storage: memoryStorage(),
            fetchSettings: vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ language: '' }),
            }),
        });

        expect(language).toBe(DEFAULT_INTERFACE_LANGUAGE);
    });

    test('keeps an explicit local choice ahead of backend configuration', async () => {
        const fetchSettings = vi.fn();
        const language = await resolveInitialInterfaceLanguage({
            storage: memoryStorage({ [INTERFACE_LANGUAGE_STORAGE_KEY]: 'fr' }),
            fetchSettings,
        });

        expect(language).toBe('fr');
        expect(fetchSettings).not.toHaveBeenCalled();
    });

    test('uses a valid backend choice when the browser has no preference', async () => {
        const language = await resolveInitialInterfaceLanguage({
            storage: memoryStorage(),
            fetchSettings: vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ language: 'es-ES' }),
            }),
        });

        expect(language).toBe('es');
    });

    test('falls back to English for invalid configuration or request failure', async () => {
        const invalid = await resolveInitialInterfaceLanguage({
            storage: memoryStorage(),
            fetchSettings: vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ language: 'de' }),
            }),
        });
        const unavailable = await resolveInitialInterfaceLanguage({
            storage: memoryStorage(),
            fetchSettings: vi.fn().mockRejectedValue(new Error('offline')),
        });

        expect(invalid).toBe('en');
        expect(unavailable).toBe('en');
    });
});

describe('interface language application', () => {
    test('initialization applies the resolved language without storing an implicit default', async () => {
        const storage = memoryStorage();
        const i18n = { resolvedLanguage: 'ca', changeLanguage: vi.fn().mockResolvedValue(undefined) };

        await initializeInterfaceLanguage(i18n, {
            storage,
            fetchSettings: vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({}),
            }),
        });

        expect(i18n.changeLanguage).toHaveBeenCalledWith('en');
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    test('an explicit choice is normalized, persisted, and applied immediately', async () => {
        const storage = memoryStorage();
        const i18n = { changeLanguage: vi.fn().mockResolvedValue(undefined) };

        await setInterfaceLanguage(i18n, 'CA-ad', storage);

        expect(storage.setItem).toHaveBeenCalledWith(INTERFACE_LANGUAGE_STORAGE_KEY, 'ca');
        expect(i18n.changeLanguage).toHaveBeenCalledWith('ca');
    });
});
