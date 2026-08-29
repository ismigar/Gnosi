import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import {
  defineStorageKey,
  jsonStorageCodec,
  readStorage,
  removeStorage,
  writeStorage,
} from '../../shared/platform/browser-storage';
import { GlobalSearchModal } from './GlobalSearchModal';


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


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};


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
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
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
  Reflect.deleteProperty(reactTestGlobal, 'IS_REACT_ACT_ENVIRONMENT');
});


function render(element: ReactElement): void {
  act(() => {
    root.render(element);
  });
}


function renderModal({
  isOpen = true,
  onClose = vi.fn(),
  onNoteSelect = vi.fn(),
}: {
  readonly isOpen?: boolean;
  readonly onClose?: () => void;
  readonly onNoteSelect?: (noteId: string) => void;
} = {}): void {
  render(
    <GlobalSearchModal
      aliasesById={{ alpha: ['Project Alpha'] }}
      allNotes={notes}
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
