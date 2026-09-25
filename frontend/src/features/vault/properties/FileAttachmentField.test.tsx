import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FileAttachmentField } from './FileAttachmentField';
import { subscribeAppEvent } from '../../../shared/platform/app-events';

interface ReactTestGlobal {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface MockInsertResult {
  readonly url?: string;
  readonly urls?: readonly string[];
}

interface MockModalProps {
  readonly onClose: () => void;
  readonly onInsert: (result: MockInsertResult) => void;
  readonly open: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown): string => {
      if (typeof options === 'string') return options;
      if (typeof options === 'object' && options !== null && 'folder' in options) {
        const folder = Reflect.get(options, 'folder');
        return `Upload to ${typeof folder === 'string' ? folder : ''}`;
      }
      return key;
    },
  }),
}));

vi.mock('../../../shared/api/notebooks', () => ({ fetchNotebookEvidence: vi.fn() }));
vi.mock('../../../shared/api/transports', () => ({ transportFetch: vi.fn() }));
vi.mock('../../../shared/notifications/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../../../shared/notifications/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../content/InsertContentModal', () => ({
  InsertContentModal: ({ onClose, onInsert, open }: MockModalProps) => open ? (
    <div data-testid="file-modal">
      <button onClick={() => {
        onInsert({ url: '/api/vault/assets/new.pdf' });
      }} type="button">
        insert-one
      </button>
      <button onClick={() => {
        onInsert({ url: '/api/vault/library/Research/source.pdf' });
      }} type="button">
        insert-duplicate
      </button>
      <button onClick={onClose} type="button">close-modal</button>
    </div>
  ) : null,
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

function renderField(
  onChange: (value: string | string[]) => void,
  value: unknown,
): HTMLDivElement {
  const nextContainer = document.createElement('div');
  document.body.appendChild(nextContainer);
  container = nextContainer;
  root = createRoot(nextContainer);
  act(() => {
    root?.render(
      <MemoryRouter>
        <FileAttachmentField
          onChange={onChange}
          propertyName="Files"
          value={value}
        />
        <ReaderLocation />
      </MemoryRouter>,
    );
  });
  return nextContainer;
}

function ReaderLocation() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function clickButton(rendered: HTMLElement, label: string): void {
  const button = [...rendered.querySelectorAll('button')]
    .find((candidate) => candidate.textContent.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  act(() => {
    button.click();
  });
}

function openModal(rendered: HTMLElement): void {
  const addButton = rendered.querySelector<HTMLButtonElement>('button[title^="Upload to"]');
  if (!addButton) throw new Error('Missing add-file button');
  act(() => {
    addButton.click();
  });
}

afterEach(() => {
  const mountedRoot = root;
  if (mountedRoot) {
    act(() => {
      mountedRoot.unmount();
    });
  }
  container?.remove();
  container = null;
  root = null;
});

describe('FileAttachmentField', () => {
  it.each([
    ['/api/vault/assets/report.pdf', '/api/vault/assets/report.pdf', 'pdf'],
    ['Assets/Files/report.pdf', '/api/vault/assets/Files/report.pdf', 'pdf'],
    ['file:///tmp/report.pdf', 'file:///tmp/report.pdf', 'pdf'],
    ['https://example.test/report.pdf', 'https://example.test/report.pdf', 'pdf'],
    ['/api/vault/library/book.epub', '/api/vault/library/book.epub', 'epub'],
  ])('opens %s in the internal document reader', (source, expected, kind) => {
    const onChange = vi.fn();
    const opened = vi.fn();
    const unsubscribe = subscribeAppEvent('gnosi:open-pdf', (detail, event) => {
      event.preventDefault();
      opened(detail);
    });
    const externalOpen = vi.spyOn(window, 'open');
    try {
      const rendered = renderField(onChange, source);
      clickButton(rendered, kind === 'pdf' ? 'report.pdf' : 'book.epub');
      expect(opened).toHaveBeenCalledWith(expect.objectContaining({ src: expected, kind }));
      expect(onChange).not.toHaveBeenCalled();
      expect(externalOpen).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('navigates to the reader when there is no dashboard event listener', () => {
    const rendered = renderField(vi.fn(), '/api/vault/assets/report.pdf');
    clickButton(rendered, 'report.pdf');
    expect(rendered.querySelector('[data-testid="location"]')?.textContent).toBe(
      '/vault/pdf?kind=pdf&src=%2Fapi%2Fvault%2Fassets%2Freport.pdf',
    );
  });

  it('opens the shared modal and appends its final stored URL', () => {
    const onChange = vi.fn<(value: string | string[]) => void>();
    const rendered = renderField(onChange, 'Assets/old.txt');

    openModal(rendered);
    expect(rendered.querySelector('[data-testid="file-modal"]')).not.toBeNull();
    clickButton(rendered, 'insert-one');

    expect(onChange).toHaveBeenCalledWith([
      'Assets/old.txt',
      '/api/vault/assets/new.pdf',
    ]);
  });

  it('rejects equivalent legacy and served Library paths', () => {
    const onChange = vi.fn<(value: string | string[]) => void>();
    const rendered = renderField(
      onChange,
      'file:///Users/ismael/Library/Research/source.pdf',
    );

    openModal(rendered);
    clickButton(rendered, 'insert-duplicate');

    expect(onChange).not.toHaveBeenCalled();
    expect(rendered.textContent).toContain('This file is already in the list.');
  });

  it('emits the backward-compatible scalar after removing one of two files', () => {
    const onChange = vi.fn<(value: string | string[]) => void>();
    const rendered = renderField(onChange, ['Assets/first.pdf', 'Assets/second.pdf']);
    const deleteButtons = rendered.querySelectorAll<HTMLButtonElement>('button[title="Delete"]');
    const firstDelete = deleteButtons.item(0);

    act(() => {
      firstDelete.click();
    });

    expect(onChange).toHaveBeenCalledWith('Assets/second.pdf');
  });
});
