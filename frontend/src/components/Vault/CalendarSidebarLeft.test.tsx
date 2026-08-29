import { act, createRef } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CalendarSidebarLeft } from './CalendarSidebarLeft';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: { language: 'en', resolvedLanguage: 'en' },
        t: (
            key: string,
            fallback?: string | { readonly defaultValue?: string },
        ) => typeof fallback === 'string'
            ? fallback
            : fallback?.defaultValue ?? key,
    }),
}));

const dispatchWindowEventMock = vi.hoisted(() => vi.fn<(event: Event) => void>());

vi.mock('../../shared/platform/browser-events', () => ({
    dispatchWindowEvent: dispatchWindowEventMock,
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


describe('CalendarSidebarLeft', () => {
    let container: HTMLDivElement;
    let root: Root;

    const calendarApi = {
        gotoDate: vi.fn(),
        next: vi.fn(),
        prev: vi.fn(),
    };

    const renderSidebar = async (
        overrides: Partial<ComponentProps<typeof CalendarSidebarLeft>> = {},
    ) => {
        const calendarRef = createRef<{ getApi: () => typeof calendarApi }>();
        calendarRef.current = { getApi: () => calendarApi };
        await act(async () => {
            root.render(
                <CalendarSidebarLeft
                    availableCalendars={['work']}
                    calendarConfigs={[{
                        source: 'work',
                        account: 'ada@example.test',
                        color: '#3b82f6',
                        name: 'Work',
                    }]}
                    calendarRef={calendarRef}
                    onNoteClick={vi.fn()}
                    selectedCalendars={new Set(['work'])}
                    undatedNotes={[{ id: 'note-1', title: 'Pending note' }]}
                    {...overrides}
                />,
            );
            await Promise.resolve();
        });
    };

    const click = async (element: HTMLElement): Promise<void> => {
        await act(async () => {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });
    };

    const buttonByTitle = (title: string): HTMLButtonElement => {
        const button = container.querySelector<HTMLButtonElement>(
            `button[title="${title}"]`,
        );
        if (!button) throw new Error(`Button missing: ${title}`);
        return button;
    };

    const buttonByLabel = (label: string): HTMLButtonElement => {
        const button = container.querySelector<HTMLButtonElement>(
            `button[aria-label="${label}"]`,
        );
        if (!button) throw new Error(`Button missing: ${label}`);
        return button;
    };

    beforeAll(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        container.remove();
    });

    it('delegates month, source and unscheduled-note navigation', async () => {
        const onNoteClick = vi.fn();
        const onToggleCalendar = vi.fn();
        await renderSidebar({ onNoteClick, onToggleCalendar });

        await click(buttonByLabel('Previous'));
        await click(buttonByLabel('Next'));
        const source = container.querySelector<HTMLElement>('span[title="Work"]');
        const note = container.querySelector<HTMLElement>('div[title="Pending note"]');
        if (!source || !note) throw new Error('Calendar source or note is missing');
        await click(source);
        await click(note);

        expect(calendarApi.prev).toHaveBeenCalledOnce();
        expect(calendarApi.next).toHaveBeenCalledOnce();
        expect(onToggleCalendar).toHaveBeenCalledWith('work');
        expect(onNoteClick).toHaveBeenCalledWith('note-1');
    });

    it('renames a calendar and marks it as default', async () => {
        const onRenameCalendar = vi.fn();
        const onSetDefaultCalendar = vi.fn();
        await renderSidebar({ onRenameCalendar, onSetDefaultCalendar });

        await click(buttonByTitle('Rename calendar'));
        const input = container.querySelector<HTMLInputElement>('input[type="text"]');
        if (!input) throw new Error('Calendar name input is missing');
        await act(async () => {
            Reflect.set(HTMLInputElement.prototype, 'value', 'Research', input);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                key: 'Enter',
            }));
            await Promise.resolve();
        });
        await click(buttonByTitle('Set as default'));

        expect(onRenameCalendar).toHaveBeenCalledWith('work', 'Research');
        expect(onSetDefaultCalendar).toHaveBeenCalledWith('work');
    });

    it('opens integration settings through the shared window adapter', async () => {
        await renderSidebar();

        await click(buttonByTitle('Add calendar'));

        const event = dispatchWindowEventMock.mock.calls.at(0)?.[0];
        expect(event).toBeInstanceOf(Event);
        if (!(event instanceof Event)) throw new Error('Settings event is missing');
        const settingsEvent = event as Event & { readonly detail?: unknown };
        expect(settingsEvent.detail).toBe('integrations');
    });
});
