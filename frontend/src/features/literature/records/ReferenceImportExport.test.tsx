import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { toast } from '../../../shared/notifications/toast';
import { exportReferences, importReferences } from '../../../shared/api/citation-io';
import { downloadBlob } from '../../../shared/platform/download';
import { ReferenceImportExport } from './ReferenceImportExport';


const navigate = vi.fn();


vi.mock('react-router-dom', () => ({
    useNavigate: () => navigate,
}));


vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../../shared/api/citation-io', () => ({
    exportReferences: vi.fn(),
    importReferences: vi.fn(),
}));


vi.mock('../../../shared/platform/download', () => ({
    downloadBlob: vi.fn(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string | { defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
    }),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];


beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => { mounted.root.unmount(); });
        mounted.container.remove();
    }
    vi.clearAllMocks();
});


function render(element: ReactElement): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    act(() => { root.render(element); });
}


async function selectImportFile(file: File): Promise<void> {
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('File input not rendered');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
    });
}


describe('ReferenceImportExport', () => {
    it('does not render without a reference table', () => {
        render(<ReferenceImportExport />);
        expect(document.body.querySelector('button')).toBeNull();
    });

    it('imports a file, reports duplicate details, and refreshes records', async () => {
        vi.mocked(importReferences).mockResolvedValueOnce({
            created: 2,
            errors: [],
            format: 'bibtex',
            items: [],
            skip_summary: { citation_key: 1, doi: 2 },
            skipped: 3,
            skipped_details: [],
            skipped_keys: [],
        });
        const onImported = vi.fn();
        render(<ReferenceImportExport onImported={onImported} tableId="references" />);

        const file = new File(['@book{}'], 'references.bib', { type: 'text/plain' });
        await selectImportFile(file);

        expect(importReferences).toHaveBeenCalledWith(file, {
            format: 'auto',
            tableId: 'references',
        });
        expect(toast.success).toHaveBeenCalledTimes(2);
        expect(onImported).toHaveBeenCalledOnce();
    });

    it('exports BibTeX through the shared download adapter', async () => {
        const blob = new Blob(['@book{}'], { type: 'application/x-bibtex' });
        vi.mocked(exportReferences).mockResolvedValueOnce(blob);
        render(<ReferenceImportExport tableId="references" />);

        const exportButton = document.body.querySelector<HTMLButtonElement>(
            '[aria-label="Export references"]',
        );
        act(() => { exportButton?.click(); });
        const bibtex = [...document.body.querySelectorAll('button')]
            .find((button) => button.textContent === 'BibTeX (.bib)');
        await act(async () => {
            bibtex?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(exportReferences).toHaveBeenCalledWith({
            format: 'bibtex',
            tableId: 'references',
        });
        expect(downloadBlob).toHaveBeenCalledWith(blob, 'recursos.bib');
    });

    it('reports import failures without refreshing records', async () => {
        vi.mocked(importReferences).mockRejectedValueOnce(new Error('invalid file'));
        const onImported = vi.fn();
        render(<ReferenceImportExport onImported={onImported} tableId="references" />);

        await selectImportFile(new File(['invalid'], 'invalid.bib'));

        expect(toast.error).toHaveBeenCalledWith('Error importing the file');
        expect(onImported).not.toHaveBeenCalled();
    });
});
