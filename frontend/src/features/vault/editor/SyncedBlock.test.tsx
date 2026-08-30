import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SyncedBlock from './SyncedBlock';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const testState = vi.hoisted(() => ({
    fetchSyncedBlock: vi.fn<(
        syncId: string,
        signal?: AbortSignal,
    ) => Promise<{ content: string; sync_id: string }>>(),
    openEventStream: vi.fn<(url: string) => EventSource>(),
    saveSyncedBlock: vi.fn<(
        syncId: string,
        content: string,
        signal?: AbortSignal,
    ) => Promise<{ content: string; saved: boolean; sync_id: string }>>(),
    supportsEventStreams: vi.fn<() => boolean>(),
    translate: (key: string, fallback: string): string => fallback || key,
}));

vi.mock('../../../shared/api/synced-blocks', () => ({
    fetchSyncedBlock: testState.fetchSyncedBlock,
    saveSyncedBlock: testState.saveSyncedBlock,
}));

vi.mock('../../../shared/api/specialized-transports', () => ({
    openEventStream: testState.openEventStream,
    supportsEventStreams: testState.supportsEventStreams,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: testState.translate }),
}));

vi.mock('../../../shared/editor/VaultMarkdown', () => ({
    VaultMarkdown: ({ md }: { md: string }) => (
        <div data-testid="vault-markdown">{md}</div>
    ),
}));

function setTextarea(textarea: HTMLTextAreaElement, value: string): void {
    act(() => {
        const setValue = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value',
        )?.set?.bind(textarea);
        if (!setValue) throw new Error('Missing native textarea value setter');
        setValue(value);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

describe('SyncedBlock', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        testState.fetchSyncedBlock.mockReset();
        testState.openEventStream.mockReset();
        testState.saveSyncedBlock.mockReset();
        testState.supportsEventStreams.mockReset();
        testState.supportsEventStreams.mockReturnValue(false);
        testState.fetchSyncedBlock.mockResolvedValue({
            content: 'Shared content',
            sync_id: 'shared/block',
        });
        testState.saveSyncedBlock.mockResolvedValue({
            content: 'Updated content',
            saved: true,
            sync_id: 'shared/block',
        });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('loads shared Markdown and saves edits with Control+Enter', async () => {
        await act(async () => {
            root.render(<SyncedBlock block={{ props: { sync_id: 'shared/block' } }} />);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(testState.fetchSyncedBlock).toHaveBeenCalledWith('shared/block');
        expect(container.querySelector('[data-testid="vault-markdown"]')?.textContent)
            .toBe('Shared content');

        const editButton = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Edit'));
        if (!(editButton instanceof HTMLButtonElement)) throw new Error('Missing edit button');
        act(() => {
            editButton.click();
        });

        const textarea = container.querySelector('textarea');
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Missing synced editor');
        setTextarea(textarea, 'Updated content');
        await act(async () => {
            textarea.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                ctrlKey: true,
                key: 'Enter',
            }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(testState.saveSyncedBlock).toHaveBeenCalledWith(
            'shared/block',
            'Updated content',
        );
        expect(container.querySelector('[data-testid="vault-markdown"]')?.textContent)
            .toBe('Updated content');
    });
});
