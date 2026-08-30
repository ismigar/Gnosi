import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FileAttachmentField } from './FileAttachmentField';

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
      <FileAttachmentField
        onChange={onChange}
        propertyName="Files"
        value={value}
      />,
    );
  });
  return nextContainer;
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
