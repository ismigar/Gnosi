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

  it.each([
    ['https://example.test/cover.jpg', 'https://example.test/cover.jpg'],
    ['Assets/Covers/cover.jpg', '/api/vault/assets/Covers/cover.jpg'],
    ['file:///Users/test/Vault/Assets/cover.jpg', '/api/vault/assets/cover.jpg'],
  ])('previews the editable image chip %s and retains open, remove and upload actions', (source, expected) => {
    const onChange = vi.fn();
    const externalOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const rendered = renderField(onChange, [source, 'Assets/keep.txt']);
    const label = rendered.querySelector<HTMLButtonElement>(`button[title="${source}"]`);
    if (!label) throw new Error('Missing image label');
    const chip = label.parentElement;
    const remove = chip?.querySelector<HTMLButtonElement>('button[title="Delete"]');
    if (!chip || !remove) throw new Error('Missing image chip controls');
    expect(document.body.querySelector('img')).toBeNull();
    act(() => { label.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    const preview = document.body.querySelector('img');
    if (!preview) throw new Error('Missing image preview');
    expect(preview.getAttribute('src')).toBe(expected);
    expect(preview.getAttribute('alt')).toBe('cover.jpg');
    expect(preview.parentElement?.style.pointerEvents).toBe('none');
    expect(onChange).not.toHaveBeenCalled();
    expect(externalOpen).not.toHaveBeenCalled();
    act(() => { preview.dispatchEvent(new Event('load')); label.focus(); });
    expect(document.body.querySelector('img')).toBe(preview);
    expect(preview.parentElement?.textContent).not.toContain('…');
    act(() => { label.click(); });
    expect(externalOpen).toHaveBeenCalledWith(expected, '_blank', 'noopener');
    expect(onChange).not.toHaveBeenCalled();
    act(() => { remove.focus(); });
    expect(document.body.querySelector('img')).toBe(preview);
    expect(preview.parentElement?.textContent).not.toContain('…');
    act(() => { remove.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })); });
    expect(document.body.querySelector('img')).toBeNull();
    act(() => { label.focus(); });
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(expected);
    act(() => { label.blur(); });
    expect(document.body.querySelector('img')).toBeNull();
    act(() => { remove.click(); });
    expect(onChange).toHaveBeenCalledWith('Assets/keep.txt');
    onChange.mockClear();
    openModal(rendered);
    clickButton(rendered, 'insert-one');
    expect(onChange).toHaveBeenCalledWith([source, 'Assets/keep.txt', '/api/vault/assets/new.pdf']);
  });

  it.each(['Assets/report.pdf', 'https://example.test/page', 'data:text/html,cover.png', 'custom:///vault/Assets/cover.png'])('does not preview non-image or unsafe attachment %s', source => {
    const onChange = vi.fn();
    const rendered = renderField(onChange, source);
    const label = rendered.querySelector<HTMLButtonElement>(`button[title="${source}"]`);
    if (!label) throw new Error('Missing attachment label');
    act(() => { label.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); label.focus(); });
    expect(document.body.querySelector('img')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    const remove = rendered.querySelector<HTMLButtonElement>('button[title="Delete"]');
    if (!remove) throw new Error('Missing delete button');
    act(() => { remove.click(); });
    expect(onChange).toHaveBeenCalledWith('');
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
