import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defineStorageKey,
    readStorage,
    removeStorage,
    stringStorageCodec,
    writeStorage,
} from '../../shared/platform/browser-storage';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const testState = vi.hoisted(() => ({
    apiFetch: vi.fn<(url: string) => Promise<unknown>>(),
    translate: (
        key: string,
        fallback?: string,
        values?: { name?: string },
    ): string => values?.name
        ? (fallback ?? key).replace('{{name}}', values.name)
        : (fallback ?? key),
}));

vi.mock('../../hooks/use-api', () => ({
    useApi: () => ({ apiFetch: testState.apiFetch }),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: testState.translate }),
}));

const WORKSPACE_ID_KEY = defineStorageKey(
    'gnosi_workspace_id',
    stringStorageCodec,
);
const USER_ROLE_KEY = defineStorageKey('gnosi_role', stringStorageCodec);
const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

describe('WorkspaceSwitcher', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        testState.apiFetch.mockReset();
        testState.apiFetch.mockResolvedValue([
            { id: 'personal', name: 'Personal', role: 'owner' },
            { id: 'team', name: 'Team', role: 'admin' },
            { id: 'team', name: 'Duplicate team', role: 'viewer' },
        ]);
        writeStorage(WORKSPACE_ID_KEY, 'team');
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        removeStorage(WORKSPACE_ID_KEY);
        removeStorage(USER_ROLE_KEY);
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('restores the active workspace, deduplicates choices, and persists its role', async () => {
        await act(async () => {
            root.render(<WorkspaceSwitcher />);
            await Promise.resolve();
        });

        expect(testState.apiFetch).toHaveBeenCalledWith('/api/workspaces');
        expect(readStorage(USER_ROLE_KEY)).toBe('admin');

        const trigger = container.querySelector('.workspace-switcher__trigger');
        expect(trigger).toBeInstanceOf(HTMLButtonElement);
        if (!(trigger instanceof HTMLButtonElement)) return;
        expect(trigger.title).toBe('Workspace: Team');

        act(() => {
            trigger.click();
        });

        const workspaceNames = [...container.querySelectorAll(
            '.workspace-switcher__item-name',
        )].map((element) => element.textContent);
        expect(workspaceNames).toEqual(['Personal', 'Team', 'New Workspace']);
    });
});
