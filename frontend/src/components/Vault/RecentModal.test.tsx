import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isCalendarPage } from './pageClassification';
import { RecentModal } from './RecentModal';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en', resolvedLanguage: 'en' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('../../hooks/useModalKeyboard', () => ({ useModalKeyboard: vi.fn() }));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});


describe('RecentModal', () => {
  it('uses the backend-compatible calendar classification', () => {
    expect(isCalendarPage({
      metadata: { date: '2026-08-29', source: 'gnosi' },
    })).toBe(true);
    expect(isCalendarPage({
      metadata: {
        date: '2026-08-29',
        source: 'gnosi-newsletter',
        table_id: 'articles',
      },
    })).toBe(false);
    expect(isCalendarPage({ folder: 'Calendar/Meetings' })).toBe(true);
  });

  it('filters calendar/index pages and opens the keyboard-selected recent note', () => {
    const onClose = vi.fn();
    const onNoteSelect = vi.fn();
    act(() => {
      root.render(
        <RecentModal
          allNotes={[
            {
              id: 'calendar',
              last_modified: '2026-08-29T14:00:00Z',
              metadata: { date: '2026-08-29', source: 'gnosi' },
              title: 'Calendar event',
            },
            {
              id: 'index',
              last_modified: '2026-08-29T13:00:00Z',
              metadata: { 'Note type': 'Index note' },
              title: 'Index · Topics',
            },
            {
              id: 'newer',
              last_modified: '2026-08-29T12:00:00Z',
              title: 'Newer note',
            },
            {
              id: 'older',
              last_modified: '2026-08-28T12:00:00Z',
              title: 'Older note',
            },
          ]}
          isOpen
          onClose={onClose}
          onNoteSelect={onNoteSelect}
        />,
      );
    });
    expect(container.textContent).toContain('Newer note');
    expect(container.textContent).toContain('Older note');
    expect(container.textContent).not.toContain('Calendar event');
    expect(container.textContent).not.toContain('Index · Topics');

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowDown',
      }));
    });
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
      }));
    });
    expect(onNoteSelect).toHaveBeenCalledWith('older');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
