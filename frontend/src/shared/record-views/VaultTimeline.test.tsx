import {
    act,
    type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultTimeline } from './VaultTimeline';
import type { TimelinePatch, VaultTimelineProps } from './vault-timeline/types';
import type { VaultViewPage } from '../records/hooks/useVaultViewData';


interface TransMockProps {
    readonly defaults: string;
    readonly values?: Readonly<Record<string, string | undefined>>;
}


const translator = (
    key: string,
    fallback?: string | { readonly defaultValue?: string },
    values?: Readonly<Record<string, string | number>>,
): string => {
    const template = typeof fallback === 'string'
        ? fallback
        : fallback?.defaultValue ?? key;
    return Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        template,
    );
};
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    Trans: ({ defaults, values }: TransMockProps): ReactNode => (
        defaults.replace('{{name}}', values?.name ?? '')
    ),
    useTranslation: () => ({ t: translator }),
}));


vi.mock('../i18n/useLocaleSettings', () => ({
    useLocaleSettings: () => ({
        currencyCode: 'EUR',
        dateFormat: 'YYYY-MM-DD',
        dateLocale: 'en-US',
        decimalSymbol: '.',
        numberLocale: 'en-US',
    }),
}));


vi.mock('../plugins/usePlugins', () => ({
    usePlugins: () => ({
        getPluginSettings: () => ({}),
        isEnabled: () => false,
    }),
}));


vi.mock('../editor/useTitlePreview', () => ({
    useTitlePreview: () => ({
        getTitleProps: () => ({}),
        preview: null,
    }),
}));


function setInputValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Input value setter is unavailable');
    const setValue = descriptor.set.bind(input);
    act(() => {
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}


describe('VaultTimeline', () => {
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

    it('renders the parent before its indented child and opens the selected note', () => {
        const onNoteSelect = vi.fn<(noteId: string) => void>();
        act(() => {
            root.render(<VaultTimeline
                activeView={{ dateField: 'Start', endDateField: 'End' }}
                notes={[
                    {
                        id: 'child',
                        metadata: {
                            End: '2024-01-04',
                            Start: '2024-01-03',
                            parent_id: 'parent',
                        },
                        title: 'Child task',
                    },
                    {
                        id: 'parent',
                        metadata: { End: '2024-01-06', Start: '2024-01-05' },
                        title: 'Parent task',
                    },
                ]}
                onNoteSelect={onNoteSelect}
                schema={{ End: 'date', Start: 'date' }}
                searchTerm=""
            />);
        });

        const text = container.textContent;
        expect(text.indexOf('Parent task')).toBeLessThan(text.indexOf('Child task'));
        const childLabel = Array.from(container.querySelectorAll<HTMLSpanElement>('span'))
            .find((element) => element.textContent === 'Child task');
        if (!childLabel) throw new Error('Child task label not rendered');
        const childRowLabel = childLabel.closest<HTMLDivElement>('div.w-64');
        expect(childRowLabel?.style.paddingLeft).toBe('32px');
        act(() => {
            childRowLabel?.click();
        });
        expect(onNoteSelect).toHaveBeenCalledWith('child');
    });

    it('renders the translated empty state when no records have dates', () => {
        act(() => {
            root.render(<VaultTimeline
                notes={[]}
                onNoteSelect={vi.fn<(noteId: string) => void>()}
                schema={{}}
                searchTerm=""
            />);
        });

        expect(container.textContent).toContain('No data to show in the timeline.');
    });

    it('wires the real toolbar filters, sorts and settings and retains active counts', () => {
        const onEditSchema = vi.fn<NonNullable<VaultTimelineProps['onEditSchema']>>();
        act(() => {
            root.render(<VaultTimeline
                notes={[
                    { id: 'alpha', title: 'Alpha', last_modified: '2024-01-01' },
                    { id: 'beta', title: 'Beta', last_modified: '2024-01-02' },
                ]}
                activeView={{
                    filters: [{ field: 'title', operator: 'is_not_empty' }],
                    sorts: [{ field: 'title', direction: 'desc' }],
                }}
                onEditSchema={onEditSchema}
            />);
        });
        const filters = container.querySelector<HTMLButtonElement>('button[title="Filters"]');
        const sorts = container.querySelector<HTMLButtonElement>('button[title="Sort"]');
        const settings = container.querySelector<HTMLButtonElement>('button[title="View settings"]');
        if (!filters || !sorts || !settings) throw new Error('Missing real toolbar controls');
        expect(filters.textContent).toBe('1');
        expect(sorts.textContent).toBe('1');
        expect(Array.from(container.querySelectorAll('div.w-64.cursor-pointer span.truncate'))
            .map(label => label.textContent)).toEqual(['Beta', 'Alpha']);
        act(() => { filters.click(); sorts.click(); settings.click(); });
        expect(onEditSchema.mock.calls).toEqual([['filters'], ['sorts'], ['settings']]);
    });

    it('opens the real search input, filters rendered notes and clears on close', () => {
        act(() => {
            root.render(<VaultTimeline notes={[
                { id: 'alpha', title: 'Alpha', last_modified: '2024-01-01' },
                { id: 'beta', title: 'Beta', metadata: null, last_modified: '2024-01-02' },
            ]} />);
        });
        const search = container.querySelector<HTMLButtonElement>('button[title="Search"]');
        if (!search) throw new Error('Missing search toggle');
        act(() => { search.click(); });
        const input = container.querySelector<HTMLInputElement>('input[placeholder="Search..."]');
        if (!input) throw new Error('Missing search input');
        setInputValue(input, 'Beta');
        expect(Array.from(container.querySelectorAll('div.w-64.cursor-pointer span.truncate'))
            .map(label => label.textContent)).toEqual(['Beta']);
        expect(input.value).toBe('Beta');
        const close = input.parentElement?.querySelector('button');
        if (!close) throw new Error('Missing clear-search button');
        act(() => { close.click(); });
        expect(container.querySelector('input[placeholder="Search..."]')).toBeNull();
        expect(container.querySelectorAll('div.w-64.cursor-pointer')).toHaveLength(2);
        const reopen = container.querySelector<HTMLButtonElement>('button[title="Search"]');
        if (!reopen) throw new Error('Missing search toggle after closing');
        act(() => { reopen.click(); });
        expect(container.querySelector<HTMLInputElement>('input[placeholder="Search..."]')?.value).toBe('');
    });

    it('renders Timeline-owned creation, zoom and scrolling controls beside the toolbar', () => {
        const onCreateRecord = vi.fn<NonNullable<VaultTimelineProps['onCreateRecord']>>();
        act(() => {
            root.render(<VaultTimeline
                notes={[{ id: 'note', title: 'Note', last_modified: '2024-01-01' }]}
                onCreateRecord={onCreateRecord}
            />);
        });
        const button = (text: string): HTMLButtonElement => {
            const found = Array.from(container.querySelectorAll('button'))
                .find(candidate => candidate.textContent === text);
            if (!found) throw new Error(`Missing button: ${text}`);
            return found;
        };
        act(() => { button('New record').click(); });
        expect(onCreateRecord).toHaveBeenCalledTimes(1);
        const grid = container.querySelector<HTMLDivElement>('div.relative.flex-1[style]');
        expect(grid?.style.minWidth).toBe('3000px');
        act(() => { button('Dia').click(); });
        expect(grid?.style.minWidth).toBe('12000px');
        act(() => { button('Set').click(); });
        expect(grid?.style.minWidth).toBe('6000px');
        act(() => { button('Mes').click(); });
        expect(grid?.style.minWidth).toBe('3000px');
        const scrollContainer = container.querySelector('div.custom-scrollbar.overflow-x-auto');
        if (!scrollContainer) throw new Error('Missing timeline scroll container');
        const scrollBy = vi.fn<(options: ScrollToOptions) => void>();
        Object.defineProperty(scrollContainer, 'scrollBy', { configurable: true, value: scrollBy });
        const left = container.querySelector('svg.lucide-chevron-left')?.closest('button');
        const right = container.querySelector('svg.lucide-chevron-right')?.closest('button');
        if (!left || !right) throw new Error('Missing timeline scroll controls');
        act(() => { left.click(); right.click(); });
        expect(scrollBy.mock.calls).toEqual([
            [{ left: -300, behavior: 'smooth' }], [{ left: 300, behavior: 'smooth' }],
        ]);
    });

    it('keeps the local toolbar hidden while an external search controls filtering', () => {
        const props: VaultTimelineProps = {
            notes: [
                { id: 'alpha', title: 'Alpha', last_modified: '2024-01-01' },
                { id: 'beta', title: 'Beta', last_modified: '2024-01-02' },
            ],
            onEditSchema: vi.fn(), onCreateRecord: vi.fn(),
        };
        act(() => { root.render(<VaultTimeline {...props} searchTerm="Beta" />); });
        expect(container.querySelector('button[title="Search"]')).toBeNull();
        expect(container.querySelector('button[title="Filters"]')).toBeNull();
        expect(container.querySelector('button[title="View settings"]')).toBeNull();
        expect(container.querySelector('svg.lucide-chevron-left')).toBeNull();
        expect(container.textContent).not.toContain('New record');
        expect(Array.from(container.querySelectorAll('div.w-64.cursor-pointer span.truncate'))
            .map(label => label.textContent)).toEqual(['Beta']);
        act(() => { root.render(<VaultTimeline {...props} searchTerm="" />); });
        expect(container.querySelector('button[title="Search"]')).toBeNull();
        expect(container.querySelectorAll('div.w-64.cursor-pointer')).toHaveLength(2);
    });

    it('keeps optional config and creation actions absent without losing filters or sort', () => {
        act(() => { root.render(<VaultTimeline />); });
        expect(container.querySelector('button[title="View settings"]')).toBeNull();
        expect(container.textContent).not.toContain('New record');
        const filters = container.querySelector<HTMLButtonElement>('button[title="Filters"]');
        const sorts = container.querySelector<HTMLButtonElement>('button[title="Sort"]');
        if (!filters || !sorts) throw new Error('Missing toolbar controls');
        act(() => { filters.click(); sorts.click(); });
        expect(container.querySelector('button[title="Search"]')).not.toBeNull();
    });

    it('renders open notes and scalar titles and safely clicks without selection callbacks', () => {
        const notes: readonly VaultViewPage[] = [
            { id: 'number', title: 27, metadata: null, last_modified: '2024-01-01' },
            { id: 'zero', title: 0, last_modified: '2024-01-02' },
            { id: 'missing', metadata: null, last_modified: '2024-01-03' },
            { id: 'null', title: null, last_modified: '2024-01-04' },
            { id: 'false', title: false, last_modified: '2024-01-05' },
            { id: 'true', title: true, last_modified: '2024-01-06' },
            { id: 'bigint', title: 72n, last_modified: '2024-01-07' },
        ];
        act(() => {
            root.render(<VaultTimeline notes={notes} searchTerm="" />);
        });
        const labels = container.querySelectorAll<HTMLDivElement>('div.w-64.cursor-pointer');
        expect(labels).toHaveLength(7);
        expect(labels[0]?.textContent).toContain('27');
        for (const index of [1, 2, 3, 4]) {
            expect(labels[index]?.textContent).toContain('Sense Títol');
        }
        expect(labels[5]?.textContent).not.toContain('true');
        expect(labels[5]?.textContent).not.toContain('Sense Títol');
        expect(labels[6]?.textContent).toContain('72');
        act(() => {
            for (const label of labels) label.click();
            for (const bar of container.querySelectorAll<HTMLDivElement>('div.group\\/bar')) {
                bar.click();
            }
        });
        expect(notes[0]?.metadata).toBeNull();
        expect(notes[0]?.title).toBe(27);
    });

    it('applies a normalized null-title template and clears selection after confirmation', async () => {
        const template = { id: 'template', title: null, extension: new Map() };
        const onApplyTemplate = vi.fn<NonNullable<VaultTimelineProps['onApplyTemplate']>>();
        act(() => {
            root.render(<VaultTimeline
                notes={[{ id: 'note', title: 19, metadata: null, last_modified: '2024-01-01' }]}
                templates={[template]}
                onApplyTemplate={onApplyTemplate}
                searchTerm=""
            />);
        });
        const selection = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!selection) throw new Error('Missing selection checkbox');
        act(() => { selection.click(); });
        const apply = container.querySelector<HTMLButtonElement>('button[title="Apply template"]');
        if (!apply) throw new Error('Missing template action');
        act(() => { apply.click(); });
        const option = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Untitled');
        if (!option) throw new Error('Missing untitled template');
        act(() => { option.click(); });
        const confirm = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'bulk_actions.confirm_apply_template');
        if (!confirm) throw new Error('Missing template confirmation');
        await act(async () => { confirm.click(); await Promise.resolve(); });
        expect(onApplyTemplate.mock.calls).toEqual([[new Set(['note']), 'template']]);
        expect(selection.checked).toBe(false);
        expect(template.title).toBeNull();
        expect(template.extension).toBeInstanceOf(Map);
    });

    it('persists a predecessor and shifts the dependent date range', async () => {
        const onUpdateNote = vi.fn<(
            noteId: string,
            patch: TimelinePatch,
        ) => Promise<void>>()
            .mockResolvedValue(undefined);
        act(() => {
            root.render(<VaultTimeline
                activeView={{ dateField: 'Start', endDateField: 'End' }}
                notes={[
                    {
                        id: 'predecessor',
                        metadata: { End: '2024-01-05', Start: '2024-01-04' },
                        title: 'Predecessor',
                    },
                    {
                        id: 'dependent',
                        metadata: { End: '2024-01-03', Start: '2024-01-02' },
                        title: 'Dependent',
                    },
                ]}
                onNoteSelect={vi.fn<(noteId: string) => void>()}
                onUpdateNote={onUpdateNote}
                schema={{ End: 'date', Start: 'date' }}
                searchTerm=""
            />);
        });

        const dependentLabel = Array.from(container.querySelectorAll<HTMLSpanElement>('span'))
            .find((element) => element.textContent === 'Dependent');
        const dependentRow = dependentLabel?.closest<HTMLDivElement>('div.group');
        const addButton = dependentRow?.querySelector<HTMLButtonElement>(
            'button[title="Add predecessor"]',
        );
        if (!addButton) throw new Error('Predecessor action not rendered');
        act(() => {
            addButton.click();
        });

        const candidate = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
            .find((button) => button.textContent.includes('Predecessor'));
        if (!candidate) throw new Error('Predecessor candidate not rendered');
        await act(async () => {
            candidate.click();
            await Promise.resolve();
        });

        expect(onUpdateNote.mock.calls[0]).toEqual([
            'dependent',
            {
                metadata: {
                    End: '2024-01-03',
                    Start: '2024-01-02',
                    predecessor_ids: ['predecessor'],
                },
            },
        ]);
        expect(onUpdateNote.mock.calls[1]).toEqual([
            'dependent',
            { metadata: { End: '2024-01-06', Start: '2024-01-05' } },
        ]);
    });
});
