import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultGallery } from './VaultGallery';
import type { GalleryContentPreview } from './GalleryCardPreview';
import type { VaultBulkActionsBarProps } from '../../../shared/record-views/VaultBulkActionsBar';
import type { VaultViewBodyProps } from './VaultViewBody';
import type { GalleryNote } from './vault-gallery/vaultGalleryModel';


const mocks = vi.hoisted(() => ({
    onNoteSelect: vi.fn(),
    contentPreview: vi.fn<(props: ComponentProps<typeof GalleryContentPreview>) => void>(),
    bulkActions: vi.fn<(props: VaultBulkActionsBarProps) => void>(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string | { readonly defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
    }),
}));


vi.mock('../../../shared/i18n/useLocaleSettings', () => ({
    useLocaleSettings: () => ({
        currencyCode: 'EUR',
        dateFormat: 'locale',
        dateLocale: 'en-US',
        decimalSymbol: '.',
        numberLocale: 'en-US',
    }),
}));


vi.mock('../../../shared/editor/useTitlePreview', () => ({
    useTitlePreview: () => ({
        getTitleProps: () => ({}),
        openForKeyboard: vi.fn(),
        preview: null,
    }),
}));


vi.mock('../../../shared/record-views/VaultBulkActionsBar', () => ({ VaultBulkActionsBar: (props: VaultBulkActionsBarProps) => {
    mocks.bulkActions(props);
    return <button onClick={() => props.onDeleteSelected?.()}>Delete selection</button>;
} }));

vi.mock('./GalleryCardPreview', () => ({
    GalleryContentPreview: (props: ComponentProps<typeof GalleryContentPreview>) => {
        mocks.contentPreview(props);
        return <div data-content-preview={props.note?.id} />;
    },
    GalleryOpenButton: () => null,
}));


describe('VaultGallery', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllMocks();
    });

    it('renders a card and opens the selected note', () => {
        act(() => {
            root.render(<VaultGallery
                activeView={{ galleryPreview: 'none' }}
                notes={[{ id: 'page-1', metadata: {}, title: 'Research note' }]}
                onNoteSelect={mocks.onNoteSelect}
                searchTerm=""
            />);
        });

        expect(container.textContent).toContain('Research note');
        const card = container.querySelector<HTMLDivElement>('div[tabindex="-1"]');
        if (!card) throw new Error('Gallery card not rendered');
        act(() => {
            card.click();
        });
        expect(mocks.onNoteSelect).toHaveBeenCalledWith('page-1');
    });

    it('keeps record creation separate from view settings', () => {
        const onCreateRecord = vi.fn();
        act(() => {
            root.render(<VaultGallery
                activeView={{ galleryPreview: 'none' }}
                notes={[]}
                onCreateRecord={onCreateRecord}
                onNoteSelect={mocks.onNoteSelect}
            />);
        });

        const addButton = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Add record'));
        if (!addButton) throw new Error('Add record button not rendered');
        act(() => {
            addButton.click();
        });
        expect(onCreateRecord).toHaveBeenCalledOnce();
    });

    it('accepts the Body contract and passes open notes unchanged to content previews', () => {
        const metadata: Record<string, unknown> = { extension: new Map([['key', 4n]]) };
        metadata.self = metadata;
        const notes = [
            { id: 'open', metadata, title: 42, body_md: { toString: () => 'Content' } },
            { id: 'null', metadata: null },
        ];
        const props: Omit<VaultViewBodyProps, 'templates'> = {
            activeView: { galleryPreview: 'content', cardSize: { imported: true }, sorts: [] },
            notes,
            allNotes: notes,
            searchTerm: '',
            onUpdateNote: () => new Map(),
        };
        act(() => { root.render(<VaultGallery {...props} />); });
        expect(mocks.contentPreview.mock.calls[0]?.[0].note).toBe(notes[0]);
        expect(mocks.contentPreview.mock.calls[1]?.[0].note).toBe(notes[1]);
        expect(notes[0]?.metadata).toBe(metadata);
        expect(container.querySelector('h3')?.title).toBe('42');
        expect(container.textContent).toContain('Untitled');
        const card = container.querySelector<HTMLDivElement>('div[tabindex="-1"]');
        if (!card) throw new Error('Gallery card not rendered');
        act(() => {
            card.click();
            card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            mocks.contentPreview.mock.calls[0]?.[0].onNoteSelect?.('open');
        });
    });

    it.each([
        { title: undefined, text: 'Untitled', attribute: null },
        { title: null, text: 'Untitled', attribute: null },
        { title: '', text: 'Untitled', attribute: '' },
        { title: false, text: 'Untitled', attribute: null },
        { title: true, text: '', attribute: null },
        { title: 0, text: 'Untitled', attribute: '0' },
        { title: 42n, text: '42', attribute: '42' },
    ])('keeps scalar title rendering for $title', ({ title, text, attribute }) => {
        act(() => {
            root.render(<VaultGallery activeView={{ galleryPreview: 'none' }}
                notes={[{ id: 'n1', title, metadata: null }]} searchTerm="" />);
        });
        expect(container.querySelector('h3')?.textContent).toBe(text);
        expect(container.querySelector('h3')?.getAttribute('title')).toBe(attribute);
    });

    it('keeps real search, filters and sorting with open metadata', () => {
        const metadata = { Status: 'Doing', Rank: { valueOf: () => 2 }, opaque: new Set([4n]) };
        act(() => {
            root.render(<VaultGallery activeView={{ galleryPreview: 'none',
                filters: [{ field: 'Status', operator: 'equals', value: 'Doing' }],
                sorts: [{ field: 'title', direction: 'asc' }],
            }} notes={[
                { id: 'b', title: 'Research B', metadata },
                { id: 'a', title: 'Research A', metadata },
                { id: 'filtered', title: 'Research C', metadata: { Status: 'Done' } },
                { id: 'search', title: 'Other', metadata },
                { id: 'null', metadata: null },
            ]} searchTerm="research" />);
        });
        expect(Array.from(container.querySelectorAll('h3'), node => node.textContent))
            .toEqual(['Research A', 'Research B']);
    });

    it('resolves an imported cover key and display settings at their use sites', () => {
        const coverField = { toString() { return this.field; }, field: 'Cover' };
        act(() => {
            root.render(<VaultGallery activeView={{ coverField, imageFit: 'cover', cardSize: 'small' }}
                notes={[{ id: 'n1', metadata: { Cover: { src: 'https://example.test/cover.png' } } }]}
                searchTerm="" />);
        });
        const cover = container.querySelector<HTMLDivElement>('[style*="background-image"]');
        expect(cover?.style.backgroundImage).toContain('https://example.test/cover.png');
        expect(cover?.classList.contains('bg-cover')).toBe(true);
        expect(container.querySelector('.h-16')).not.toBeNull();
    });

    it('starts groups collapsed and mounts cards on expansion without layout measurements', () => {
        act(() => {
            root.render(<VaultGallery activeView={{ groupBy: 'Status', galleryPreview: 'none' }}
                notes={[{ id: 'n1', title: 42, metadata: { Status: 'Doing' } }]}
                searchTerm="" />);
        });
        expect(container.textContent).toBe('Doing1');
        expect(container.querySelector('input[type="checkbox"]')).toBeNull();
        const header = container.querySelector<HTMLButtonElement>('button[title="Expand"]');
        if (!header) throw new Error('Group header not rendered');
        act(() => { header.click(); });
        expect(container.textContent).toContain('42');
        expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    });

    it('passes valid templates unchanged and clears selection after applying one', () => {
        const template = { id: 'template', title: null, extension: new Map() };
        const templates = [template];
        const onApplyTemplate = vi.fn();
        act(() => {
            root.render(<VaultGallery activeView={{ galleryPreview: 'none' }}
                notes={[{ id: 'n1', metadata: null }]} templates={templates}
                onApplyTemplate={onApplyTemplate} searchTerm="" />);
        });
        const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!checkbox) throw new Error('Checkbox not rendered');
        act(() => { checkbox.click(); });
        const bulk = mocks.bulkActions.mock.calls.at(-1)?.[0];
        expect(bulk?.templates).toBe(templates);
        expect(bulk?.templates?.[0]).toBe(template);
        act(() => { bulk?.onApplyTemplate?.('template'); });
        expect(onApplyTemplate).toHaveBeenCalledWith(new Set(['n1']), 'template');
        expect(checkbox.checked).toBe(false);
    });

    it('forwards optional callbacks and deletes scalar or absent titles without changing the notes', () => {
        const onDeletePage = vi.fn<(id: string, title?: GalleryNote['title']) => void>();
        const onFocusShell = vi.fn();
        const onOpenParallel = vi.fn();
        const notes = [{ id: 'n1', title: 4n, metadata: null }, { id: 'n2' }];
        act(() => {
            root.render(<VaultGallery activeView={{ galleryPreview: 'content', sorts: [] }} notes={notes}
                onDeletePage={onDeletePage} onFocusShell={onFocusShell}
                onOpenParallel={onOpenParallel} searchTerm="" />);
        });
        act(() => {
            mocks.contentPreview.mock.calls[0]?.[0].onOpenParallel?.('parallel');
            container.querySelector('div[tabindex="-1"]')?.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );
            container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => { input.click(); });
        });
        const deleteButton = container.querySelector<HTMLButtonElement>('button');
        if (!deleteButton) throw new Error('Bulk delete not rendered');
        act(() => { deleteButton.click(); });
        expect(onDeletePage.mock.calls).toEqual([['n1', 4n], ['n2', undefined]]);
        expect(onFocusShell).toHaveBeenCalledOnce();
        expect(onOpenParallel).toHaveBeenCalledWith('parallel');
        expect(notes[0]?.title).toBe(4n);
        expect(container.querySelector('button')).toBeNull();
    });
});
