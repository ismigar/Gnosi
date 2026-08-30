import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TldrawEditor from './TldrawEditor';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface MockStore {
    listen: (
        listener: () => void,
        options?: unknown,
    ) => () => void;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const testState = vi.hoisted(() => ({
    createVaultPage: vi.fn<() => Promise<{ id: string; title: string }>>(),
    documentListener: null as (() => void) | null,
    fetchDrawing: vi.fn<(drawingId: string) => Promise<Record<string, unknown>>>(),
    getSnapshot: vi.fn<() => Record<string, unknown>>(),
    loadSnapshot: vi.fn<(store: unknown, snapshot: unknown) => void>(),
    recognizeHandwriting: vi.fn<() => Promise<{
        corrected: boolean;
        text: string;
    }>>(),
    saveDrawing: vi.fn<(
        drawingId: string,
        input: Readonly<Record<string, unknown>>,
    ) => Promise<unknown>>(),
    unsubscribe: vi.fn<() => void>(),
    warmupHandwriting: vi.fn<() => Promise<unknown>>(),
}));

const store: MockStore = {
    listen: (listener) => {
        testState.documentListener = listener;
        return testState.unsubscribe;
    },
};

vi.mock('tldraw', () => ({
    Tldraw: () => <div data-testid="tldraw-canvas" />,
    createTLStore: () => store,
    getSnapshot: testState.getSnapshot,
    loadSnapshot: testState.loadSnapshot,
}));

vi.mock('@tldraw/tlschema', () => ({
    createShapeId: () => 'shape:test',
    toRichText: (text: string) => ({ type: 'doc', text }),
}));

vi.mock('./tldraw-editor/tldrawEditorBridges', () => ({
    CANVAS_SHAPE_UTILS: [],
    CanvasPageProvider: ({ children }: { readonly children: ReactNode }) => children,
    TldrawGlobalSearchModal: ({ isOpen }: { readonly isOpen: boolean }) => (
        isOpen ? <div data-testid="vault-search" /> : null
    ),
}));

vi.mock('../../shared/hooks/useMediaQuery', () => ({
    useMediaQuery: () => false,
}));

vi.mock('../../plugins/usePlugins', () => ({
    usePlugins: () => ({ isEnabled: () => true }),
}));

vi.mock('../../shared/api/drawings', () => ({
    fetchDrawing: testState.fetchDrawing,
    recognizeHandwriting: testState.recognizeHandwriting,
    saveDrawing: testState.saveDrawing,
    warmupHandwriting: testState.warmupHandwriting,
}));

vi.mock('../../shared/api/vaults', () => ({
    createVaultPage: testState.createVaultPage,
    fetchVaultPage: vi.fn(),
}));

vi.mock('../../lib/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string): string => key }),
}));

describe('TldrawEditor', () => {
    let container: HTMLDivElement;
    let root: Root | null;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        testState.createVaultPage.mockReset();
        testState.documentListener = null;
        testState.fetchDrawing.mockReset();
        testState.getSnapshot.mockReset();
        testState.loadSnapshot.mockReset();
        testState.recognizeHandwriting.mockReset();
        testState.saveDrawing.mockReset();
        testState.unsubscribe.mockReset();
        testState.warmupHandwriting.mockReset();
        testState.getSnapshot.mockReturnValue({
            schema: { schemaVersion: 2 },
            store: { 'shape:one': { typeName: 'shape' } },
        });
        testState.saveDrawing.mockResolvedValue({ id: 'drawing-1', status: 'ok' });
        testState.warmupHandwriting.mockResolvedValue({ loaded: true, warming: false });
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
        }
        container.remove();
        root = null;
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    async function renderEditor(): Promise<void> {
        await act(async () => {
            root?.render(
                <TldrawEditor
                    drawingId="drawing-1"
                    onClose={vi.fn()}
                    title="Research map"
                />,
            );
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    it('loads wrapped snapshots before enabling the drawing UI', async () => {
        const wrappedSnapshot = {
            document: {
                schema: { schemaVersion: 1 },
                store: { 'shape:legacy': { typeName: 'shape' } },
            },
        };
        testState.fetchDrawing.mockResolvedValue(wrappedSnapshot);

        await renderEditor();

        expect(testState.loadSnapshot).toHaveBeenCalledWith(store, {
            schema: { schemaVersion: 1 },
            store: { 'shape:legacy': { typeName: 'shape' } },
        });
        expect(container.textContent).toContain('tldraw.add_note');
        expect(container.querySelector('[data-testid="tldraw-canvas"]')).not.toBeNull();
    });

    it('locks a legacy drawing instead of overwriting it', async () => {
        testState.fetchDrawing.mockResolvedValue({ elements: [{ id: 'legacy' }] });

        await renderEditor();

        expect(container.textContent).toContain('tldraw.incompatible_title');
        expect(testState.loadSnapshot).not.toHaveBeenCalled();
        expect(testState.saveDrawing).not.toHaveBeenCalled();
        expect(testState.documentListener).toBeNull();
    });

    it('flushes a pending document change when the editor closes', async () => {
        const onSaveSuccess = vi.fn<() => void>();
        testState.fetchDrawing.mockResolvedValue({});
        await act(async () => {
            root?.render(
                <TldrawEditor
                    drawingId="drawing-1"
                    onClose={vi.fn()}
                    onSaveSuccess={onSaveSuccess}
                    title="Research map"
                />,
            );
            await Promise.resolve();
            await Promise.resolve();
        });
        const listener = testState.documentListener;
        if (!listener) throw new Error('Missing document autosave listener');

        await act(async () => {
            listener();
            root?.unmount();
            root = null;
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(testState.unsubscribe).toHaveBeenCalledOnce();
        expect(testState.saveDrawing).toHaveBeenCalledWith('drawing-1', {
            data: {
                schema: { schemaVersion: 2 },
                store: { 'shape:one': { typeName: 'shape' } },
            },
            metadata: {},
            title: 'Research map',
        });
        expect(onSaveSuccess).toHaveBeenCalledOnce();
    });
});
