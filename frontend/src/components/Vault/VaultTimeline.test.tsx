import {
    act,
    type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultTimeline } from './VaultTimeline';
import type { TimelinePatch } from './vault-timeline/types';


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


vi.mock('../../hooks/useLocaleSettings', () => ({
    useLocaleSettings: () => ({
        currencyCode: 'EUR',
        dateFormat: 'YYYY-MM-DD',
        dateLocale: 'en-US',
        decimalSymbol: '.',
        numberLocale: 'en-US',
    }),
}));


vi.mock('../../plugins/usePlugins', () => ({
    usePlugins: () => ({
        getPluginSettings: () => ({}),
        isEnabled: () => false,
    }),
}));


vi.mock('./useTitlePreview', () => ({
    useTitlePreview: () => ({
        getTitleProps: () => ({}),
        preview: null,
    }),
}));


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
