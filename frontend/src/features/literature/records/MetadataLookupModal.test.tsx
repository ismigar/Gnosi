import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MetadataLookupModal } from './MetadataLookupModal';


const { lookupMetadata, recognizePdf, translateUrl } = vi.hoisted(() => ({
    lookupMetadata: vi.fn(),
    recognizePdf: vi.fn(),
    translateUrl: vi.fn(),
}));


vi.mock('../../../shared/api/resource-lookup', () => ({
    lookupMetadata,
    recognizePdf,
    translateUrl,
}));


vi.mock('../../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));


const { toast } = vi.hoisted(() => ({
    toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock('../../../shared/notifications/toast', () => ({ toast }));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: { language: 'ca' },
        t: (key: string, options?: string | { defaultValue?: string }) => (
            typeof options === 'string'
                ? options
                : options?.defaultValue ?? key
        ),
    }),
}));


interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}


const mountedRoots: MountedRoot[] = [];


const render = async (element: ReactElement): Promise<HTMLDivElement> => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    await act(async () => {
        root.render(element);
        await Promise.resolve();
    });
    return document.body.querySelector<HTMLDivElement>('#metadata-lookup-root')
        ?? container;
};


const buttonByText = (container: HTMLElement, text: string): HTMLButtonElement => {
    const button = [...container.querySelectorAll('button')]
        .find((item) => item.textContent.includes(text));
    if (!button) throw new Error(`Button not rendered: ${text}`);
    return button;
};


beforeAll(() => {
    const reactTestEnvironment = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
    };
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
    vi.clearAllMocks();
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
    document.getElementById('metadata-lookup-root')?.remove();
});


describe('MetadataLookupModal', () => {
    it('looks up a DOI and applies only selected metadata', async () => {
        lookupMetadata.mockResolvedValue({
            error: null,
            identifier: '10.1234/example',
            source: 'crossref',
            suggested: {
                DOI: '10.1234/example',
                'Item Type': 'journalArticle',
                Title: 'Evidence',
            },
        });
        const onApply = vi.fn();
        const container = await render(
            <MetadataLookupModal
                currentMetadata={{ DOI: '10.1234/example', Title: '' }}
                isOpen
                onApply={onApply}
                onClose={vi.fn()}
            />,
        );

        await act(async () => {
            buttonByText(container, 'Search').dispatchEvent(
                new MouseEvent('click', { bubbles: true }),
            );
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Evidence');
        expect(container.textContent).toContain('Article de revista acadèmica');
        act(() => {
            buttonByText(container, 'Apply selection').dispatchEvent(
                new MouseEvent('click', { bubbles: true }),
            );
        });
        expect(onApply).toHaveBeenCalledWith({
            'Item Type': 'journalArticle',
            Title: 'Evidence',
        });
    });

    it('uses URL translation and creates directly in create mode', async () => {
        translateUrl.mockResolvedValue({
            count: 1,
            error: null,
            identifier: 'https://example.com/evidence',
            source: 'web',
            suggested: { Title: 'Web evidence' },
        });
        const onClose = vi.fn();
        const onCreate = vi.fn();
        const container = await render(
            <MetadataLookupModal
                currentMetadata={{ URL: 'https://example.com/evidence' }}
                isOpen
                mode="create"
                onClose={onClose}
                onCreate={onCreate}
            />,
        );

        await act(async () => {
            buttonByText(container, 'Search').dispatchEvent(
                new MouseEvent('click', { bubbles: true }),
            );
            await Promise.resolve();
        });

        expect(translateUrl).toHaveBeenCalledWith(
            { url: 'https://example.com/evidence' },
            expect.any(AbortSignal),
        );
        expect(onCreate).toHaveBeenCalledWith({ Title: 'Web evidence' });
        expect(onClose).toHaveBeenCalledOnce();
        expect(lookupMetadata).not.toHaveBeenCalled();
    });

    it('forwards the original PDF for attachment and cover creation', async () => {
        recognizePdf.mockResolvedValue({
            error: null, identifiers: {}, source: 'pdf',
            suggested: { Title: 'Uploaded report', 'Item Type': 'report' },
        });
        const onCreate = vi.fn();
        const container = await render(<MetadataLookupModal isOpen mode="create" onCreate={onCreate} />);
        const input = container.querySelector<HTMLInputElement>('input[type="file"]');
        if (!input) throw new Error('Missing PDF input');
        const file = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });
        Object.defineProperty(input, 'files', { value: [file] });
        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        expect(onCreate).toHaveBeenCalledWith({ Title: 'Uploaded report', 'Item Type': 'report' }, file);
    });

    it('shows a cover preview and leaves an existing cover unselected', async () => {
        lookupMetadata.mockResolvedValue({
            error: null, identifier: '10.1234/cover', source: 'crossref',
            suggested: { Title: 'Paper', cover: 'https://example.org/proposed.jpg' },
        });
        const onApply = vi.fn();
        const container = await render(<MetadataLookupModal isOpen onApply={onApply}
            currentMetadata={{ DOI: '10.1234/cover', cover: 'https://example.org/chosen.jpg' }} />);
        await act(async () => {
            buttonByText(container, 'Search').click();
            await Promise.resolve();
        });
        expect(container.querySelector('img[src="https://example.org/proposed.jpg"]')).not.toBeNull();
        act(() => { buttonByText(container, 'Apply selection').click(); });
        expect(onApply).toHaveBeenCalledWith({ Title: 'Paper' });
    });
});
