import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrawingSummary } from '../../shared/api/drawings';
import VaultDrawings, { type VaultDrawingsProps } from './VaultDrawings';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const testState = vi.hoisted(() => ({
    deleteDrawing: vi.fn<(drawingId: string) => Promise<unknown>>(),
    listDrawings: vi.fn<() => Promise<DrawingSummary[]>>(),
    toastError: vi.fn<(message: string) => void>(),
    toastSuccess: vi.fn<(message: string) => void>(),
    translate: (key: string, fallback: string): string => fallback || key,
}));

vi.mock('../../shared/api/drawings', () => ({
    deleteDrawing: testState.deleteDrawing,
    listDrawings: testState.listDrawings,
}));

vi.mock('../../lib/toast', () => ({
    default: {
        error: testState.toastError,
        success: testState.toastSuccess,
    },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: testState.translate }),
}));

describe('VaultDrawings', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        testState.deleteDrawing.mockReset();
        testState.listDrawings.mockReset();
        testState.toastError.mockReset();
        testState.toastSuccess.mockReset();
        testState.listDrawings.mockResolvedValue([{
            id: 'drawing-1',
            last_modified: '2026-08-29T08:00:00Z',
            size: 2048,
            title: 'Architecture sketch',
        }]);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('loads drawing summaries and preserves the selection callback', async () => {
        const onDrawingSelect = vi.fn<VaultDrawingsProps['onDrawingSelect']>();
        await act(async () => {
            root.render(<VaultDrawings onDrawingSelect={onDrawingSelect} />);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(testState.listDrawings).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Architecture sketch');
        expect(container.textContent).toContain('2.0 KB');
        const card = container.querySelector('.group');
        if (!(card instanceof HTMLDivElement)) throw new Error('Missing drawing card');
        act(() => {
            card.click();
        });
        expect(onDrawingSelect).toHaveBeenCalledWith(
            'drawing-1',
            'Architecture sketch',
        );
    });
});
