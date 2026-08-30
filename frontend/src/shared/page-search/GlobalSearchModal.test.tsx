import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchWindowEvent } from '../platform/browser-events';
import {
  defineStorageKey,
  jsonStorageCodec,
  readStorage,
  removeStorage,
  writeStorage,
} from '../platform/browser-storage';
import { GlobalSearchModal, type GlobalSearchNote } from './GlobalSearchModal';


interface SavedSearch {
  readonly label: string;
  readonly query: string;
}


function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}


function isUnknownRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function isSavedSearches(value: unknown): value is readonly SavedSearch[] {
  return isUnknownArray(value) && value.every((entry) => (
    isUnknownRecord(entry)
    && typeof entry.label === 'string'
    && typeof entry.query === 'string'
  ));
}


const savedSearchesKey = defineStorageKey(
  'gnosi.savedSearches',
  jsonStorageCodec(isSavedSearches),
);
const stableTranslate = (
  key: string,
  fallback?: string | Readonly<Record<string, unknown>>,
  interpolation?: Readonly<Record<string, unknown>>,
): string => {
  const template = typeof fallback === 'string' ? fallback : key;
  const query = interpolation?.query;
  return typeof query === 'string'
    ? template.replace('{{query}}', query)
    : template;
};


vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableTranslate }),
}));


const notes = [
  {
    folder: 'BD/Projects',
    id: 'alpha',
    metadata: { icon: '⭐', topics: ['strategy', 'planning'] },
    resolved_table_id: 'projects',
    title: 'Alpha roadmap',
  },
  {
    folder: 'Notes',
    id: 'beta',
    metadata: { tags: ['research'] },
    title: 'Beta note',
  },
  {
    folder: 'BD/Research',
    id: 'research-db',
    is_database: true,
    metadata: {},
    title: 'Research database',
  },
];
const tables = [{
  id: 'projects',
  name: 'Projects',
  properties: [{
    config: { role: 'tags' },
    id: 'topics',
    name: 'Tags',
    type: 'multi_select',
  }],
}];


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true, writable: true, value: true,
  });
  vi.useFakeTimers();
  removeStorage(savedSearchesKey);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  removeStorage(savedSearchesKey);
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.useRealTimers();
  vi.clearAllMocks();
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});


function render(element: ReactElement): void {
  act(() => {
    root.render(element);
  });
}


function renderModal({
  allNotes = notes,
  isOpen = true,
  onClose = vi.fn(),
  onNoteSelect = vi.fn(),
}: {
  readonly allNotes?: readonly GlobalSearchNote[];
  readonly isOpen?: boolean;
  readonly onClose?: () => void;
  readonly onNoteSelect?: (noteId: string) => void;
} = {}): void {
  render(
    <GlobalSearchModal
      aliasesById={{ alpha: ['Project Alpha'] }}
      allNotes={allNotes}
      globalIndex={{ gamma: 'Gamma indexed note' }}
      isOpen={isOpen}
      onClose={onClose}
      onNoteSelect={onNoteSelect}
      tables={tables}
    />,
  );
}


function requiredInput(): HTMLInputElement {
  const input = container.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Global search input was not rendered');
  }
  return input;
}


function setInputValue(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.bind(input);
  if (!setValue) throw new Error('Missing native input value setter');
  act(() => {
    setValue(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}


function buttonWithText(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent.includes(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}


function buttonWithTitle(title: string): HTMLButtonElement {
  const button = container.querySelector(`button[title="${title}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing titled button: ${title}`);
  }
  return button;
}


describe('GlobalSearchModal', () => {
  it.each(['click', 'Enter'])('opens an opaque original note with %s without traversing extensions', action => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const arrayCycle: unknown[] = [];
    arrayCycle.push(arrayCycle);
    const readOpaque = vi.fn((): never => { throw new Error('opaque getter'); });
    const metadata = Object.freeze({
      icon: '⭐', topics: ['strategy'], cycle, arrayCycle,
      blob: new Blob(['private']), callback: () => 'private', symbol: Symbol('private'),
      get extension(): never { return readOpaque(); },
    });
    const row = Object.freeze({
      id: 'alpha', title: 'Alpha roadmap', resolved_table_id: 'projects', metadata,
      get plugin(): never { return readOpaque(); },
    });
    const allNotes = Object.freeze([row]);
    const onClose = vi.fn();
    const onNoteSelect = vi.fn();
    renderModal({ allNotes, isOpen: false, onClose, onNoteSelect });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    renderModal({ allNotes, onClose, onNoteSelect });
    setInputValue(requiredInput(), 'tag:strategy');
    const result = buttonWithText('Alpha roadmap');
    expect(result.textContent).toContain('Projects');
    expect(result.textContent).toContain('#strategy');
    act(() => {
      if (action === 'click') result.click();
      else dispatchWindowEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });
    expect(onNoteSelect).toHaveBeenCalledExactlyOnceWith('alpha');
    expect(onClose).toHaveBeenCalledOnce();
    expect(allNotes[0]).toBe(row);
    expect(row.metadata).toBe(metadata);
    expect(metadata.cycle.self).toBe(cycle);
    expect(metadata.arrayCycle[0]).toBe(arrayCycle);
    expect(readOpaque).not.toHaveBeenCalled();
  });

  it('searches notes with absent and null metadata and opens their original IDs', () => {
    const absent = Object.freeze({ id: 'absent', title: 'Absent metadata' });
    const nullable = Object.freeze({ id: 'nullable', title: 'Null metadata', metadata: null });
    const onNoteSelect = vi.fn();
    const onClose = vi.fn();
    renderModal({ allNotes: [absent, nullable], onNoteSelect, onClose });
    setInputValue(requiredInput(), 'metadata');
    expect(container.textContent).toContain('Absent metadata');
    expect(container.textContent).toContain('Null metadata');
    act(() => { buttonWithText('Absent metadata').click(); });
    expect(onNoteSelect).toHaveBeenNthCalledWith(1, 'absent');
    setInputValue(requiredInput(), 'null');
    act(() => {
      dispatchWindowEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });
    expect(onNoteSelect).toHaveBeenNthCalledWith(2, 'nullable');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(absent).not.toHaveProperty('metadata');
    expect(nullable.metadata).toBeNull();
  });

  it('keeps tag coercion and field-name fallback in the real modal', () => {
    const tag = {
      toString(this: unknown): string {
        expect(this).toBe(tag);
        return '#École';
      },
    };
    renderModal({ allNotes: [{
      id: 'alpha', title: 'Alpha roadmap',
      metadata: { table_id: 'projects', topics: null, Tags: [tag] },
    }] });
    setInputValue(requiredInput(), 'tag:ecole');
    expect(buttonWithText('Alpha roadmap').textContent).toContain('#ecole');
    expect(buttonWithText('Alpha roadmap').textContent).toContain('Projects');
  });

  it('stays unmounted while closed', () => {
    renderModal({ isOpen: false });
    expect(container.textContent).toBe('');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });


  it('renders the accessible empty state and focuses the query', () => {
    renderModal();
    const input = requiredInput();
    expect(container.querySelector('[role="dialog"]')?.getAttribute(
      'aria-label',
    )).toBe('Search');
    expect(container.textContent).toContain('Search by title or with operators:');

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(document.activeElement).toBe(input);

    setInputValue(input, 'missing phrase');
    expect(container.textContent).toContain(
      'No results found for "missing phrase"',
    );
  });


  it('shows search metadata and opens the mouse-selected note', () => {
    const onClose = vi.fn();
    const onNoteSelect = vi.fn();
    renderModal({ onClose, onNoteSelect });
    setInputValue(requiredInput(), 'Project Alpha');

    expect(container.textContent).toContain('Alpha roadmap');
    expect(container.textContent).toContain('Projects');
    expect(container.textContent).toContain('#strategy');
    expect(container.textContent).not.toContain('Beta note');
    act(() => {
      buttonWithText('Alpha roadmap').click();
    });
    expect(onNoteSelect).toHaveBeenCalledWith('alpha');
    expect(onClose).toHaveBeenCalledOnce();
  });


  it('moves the selection with arrows and opens it with Enter', () => {
    const onClose = vi.fn();
    const onNoteSelect = vi.fn();
    renderModal({ onClose, onNoteSelect });
    setInputValue(requiredInput(), 'note');

    act(() => {
      dispatchWindowEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowDown',
      }));
    });
    act(() => {
      dispatchWindowEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
      }));
    });

    expect(onNoteSelect).toHaveBeenCalledWith('gamma');
    expect(onClose).toHaveBeenCalledOnce();
  });


  it('loads, applies, removes and creates saved searches', () => {
    writeStorage(savedSearchesKey, [{
      label: 'Strategy search',
      query: 'tag:strategy',
    }]);
    renderModal();

    expect(container.textContent).toContain('Saved searches');
    act(() => {
      buttonWithText('Strategy search').click();
    });
    expect(requiredInput().value).toBe('tag:strategy');
    expect(container.textContent).toContain('Alpha roadmap');

    setInputValue(requiredInput(), 'Beta');
    act(() => {
      buttonWithTitle('Save this search').click();
    });
    expect(readStorage(savedSearchesKey)).toEqual([
      { label: 'Beta', query: 'Beta' },
      { label: 'Strategy search', query: 'tag:strategy' },
    ]);

    setInputValue(requiredInput(), '');
    const strategyChip = Array.from(container.querySelectorAll('span'))
      .find((candidate) => candidate.textContent.includes('Strategy search'));
    const removeButton = strategyChip?.querySelector('button[title="Remove"]');
    if (!(removeButton instanceof HTMLButtonElement)) {
      throw new Error('Missing remove button for the strategy search');
    }
    act(() => {
      removeButton.click();
    });
    expect(readStorage(savedSearchesKey)).toEqual([
      { label: 'Beta', query: 'Beta' },
    ]);
  });
});
