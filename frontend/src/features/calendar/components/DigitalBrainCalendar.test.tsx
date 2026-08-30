import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type FullCalendar from '@fullcalendar/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DigitalBrainCalendar } from './DigitalBrainCalendar';
import { toast } from '../../../shared/notifications/toast';

vi.mock('react-i18next', () => {
  const t = (_key: string, fallback: unknown) => typeof fallback === 'string' ? fallback : _key;
  const i18n = { language: 'en' };
  return { useTranslation: () => ({ t, i18n }) };
});
vi.mock('../../../shared/editor/useTitlePreview', () => {
  const value = { openHover: vi.fn(), scheduleClose: vi.fn(), preview: null };
  return { useTitlePreview: () => value };
});
vi.mock('../../../shared/notifications/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const NOTES = [
  { id: 'one', title: 'Calendar contract event', metadata: { date: '2026-09-02', end_date: '2026-09-03' } },
  { id: 'external', title: 'External contract event', metadata: { date: '2026-09-04', readonly: true } },
];

let container: HTMLDivElement;
let root: Root;
beforeAll(() => {
  const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); vi.clearAllMocks(); });

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); await Promise.resolve(); });
}

async function update(action: () => void): Promise<void> {
  await act(async () => { action(); await Promise.resolve(); });
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });
}

function button(label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find((item) => item.title === label || item.textContent === label);
  if (!result) throw new Error(`Missing calendar button: ${label}`);
  return result;
}

function eventElement(title: string): HTMLElement {
  const result = [...container.querySelectorAll('.fc-event-title')].find((item) => item.textContent === title);
  if (!(result instanceof HTMLElement)) throw new Error(`Missing calendar event: ${title}`);
  return result;
}

describe('DigitalBrainCalendar with real FullCalendar', () => {
  it('navigates and switches every view without the native toolbar rendering loop', async () => {
    const calendarRef = createRef<FullCalendar>();
    await render(<DigitalBrainCalendar allNotes={NOTES} ignoreCalendarFilter showHeaderToolbar calendarRef={calendarRef} />);
    await update(() => { calendarRef.current?.getApi().gotoDate('2026-09-02'); });
    expect(container.textContent).toContain('September 2026');
    await update(() => { button('Next').click(); });
    expect(container.textContent).toContain('October 2026');
    await update(() => { button('Previous').click(); });
    expect(container.textContent).toContain('September 2026');
    for (const [label, view] of [['Setmana', 'timeGridWeek'], ['Dia', 'timeGridDay'], ['Any', 'multiMonthYear'], ['Mes', 'dayGridMonth']]) {
      await update(() => { button(label || '').click(); });
      expect(calendarRef.current?.getApi().view.type).toBe(view);
    }
    expect(document.querySelector('.fc-header-toolbar')).toBeNull();
    expect(calendarRef.current?.getApi().getEventById('one')?.endStr).toBe('2026-09-04');
  });

  it('edits a vault event, protects read-only events and preserves event context menus', async () => {
    const calendarRef = createRef<FullCalendar>();
    const onEventEdit = vi.fn();
    const onContextMenu = vi.fn();
    await render(<DigitalBrainCalendar allNotes={NOTES} ignoreCalendarFilter calendarRef={calendarRef} onEventEdit={onEventEdit} onContextMenu={onContextMenu} />);
    await update(() => { calendarRef.current?.getApi().gotoDate('2026-09-02'); });
    const event = eventElement('Calendar contract event');
    await update(() => { event.click(); });
    expect(onEventEdit).toHaveBeenCalledWith('one');
    await update(() => { event.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 })); });
    expect(onContextMenu).toHaveBeenCalledWith({ x: 40, y: 60, date: '2026-09-02', eventId: 'one', instanceStart: '2026-09-02', allDay: true });
    await update(() => { eventElement('External contract event').click(); });
    expect(toast.error).toHaveBeenCalledWith('External event (read-only).');
    expect(onEventEdit).toHaveBeenCalledOnce();
  });

  it('passes selection bounds without changing FullCalendar exclusive end semantics', async () => {
    const calendarRef = createRef<FullCalendar>();
    const onSelection = vi.fn();
    await render(<DigitalBrainCalendar allNotes={NOTES} ignoreCalendarFilter calendarRef={calendarRef} onSelection={onSelection} />);
    await update(() => { calendarRef.current?.getApi().select({ start: '2026-09-02', end: '2026-09-04', allDay: true }); });
    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ startStr: '2026-09-02', endStr: '2026-09-04', allDay: true }));
  });

  it('preserves modifier selection, keyboard deletion and Escape without opening an editor', async () => {
    const calendarRef = createRef<FullCalendar>();
    const onDeleteSelected = vi.fn();
    const onEventEdit = vi.fn();
    await render(<DigitalBrainCalendar allNotes={NOTES} ignoreCalendarFilter calendarRef={calendarRef} onDeleteSelected={onDeleteSelected} onEventEdit={onEventEdit} />);
    await update(() => { calendarRef.current?.getApi().gotoDate('2026-09-02'); });
    await update(() => { eventElement('Calendar contract event').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    expect(onEventEdit).not.toHaveBeenCalled();
    expect(container.textContent).toContain('bulk_actions.selected_count');
    await update(() => { container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); });
    expect(onDeleteSelected).toHaveBeenCalledWith(new Set(['one']));
    expect(container.textContent).not.toContain('bulk_actions.selected_count');
    await update(() => { container.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })); });
    expect(container.textContent).toContain('bulk_actions.selected_count');
    await update(() => { container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.textContent).not.toContain('bulk_actions.selected_count');
  });
});
