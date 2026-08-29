import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { toast } from '../../lib/toast';
import {
  createVaultInlineComment,
  deleteVaultInlineComment,
  fetchVaultInlineComments,
  updateVaultInlineComment,
  type VaultInlineComment,
} from '../../shared/api/vault-comments';
import { emitAppEvent } from '../../shared/platform/app-events';
import InlineComments from './InlineComments';


interface ReactTestGlobal {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}


interface TranslationValues {
  readonly count?: number;
  readonly defaultValue?: string;
}


type TranslationFallback = string | TranslationValues;


const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const apiState = vi.hoisted(() => ({ role: 'admin' }));


vi.mock('../../hooks/use-api', () => ({
  useApi: () => apiState,
}));


vi.mock('../../lib/toast', () => ({
  toast: { error: vi.fn() },
}));


vi.mock('../../shared/api/vault-comments', () => ({
  createVaultInlineComment: vi.fn(),
  deleteVaultInlineComment: vi.fn(),
  fetchVaultInlineComments: vi.fn(),
  updateVaultInlineComment: vi.fn(),
}));


function translate(
  key: string,
  fallback?: TranslationFallback,
  values?: TranslationValues,
): string {
  const template = typeof fallback === 'string'
    ? fallback
    : fallback?.defaultValue ?? key;
  const count = values?.count ?? (
    typeof fallback === 'object' ? fallback.count : undefined
  );
  return count === undefined
    ? template
    : template.replace('{{count}}', String(count));
}


vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));


const createCommentMock = vi.mocked(createVaultInlineComment);
const deleteCommentMock = vi.mocked(deleteVaultInlineComment);
const fetchCommentsMock = vi.mocked(fetchVaultInlineComments);
const updateCommentMock = vi.mocked(updateVaultInlineComment);
const errorToastMock = vi.mocked(toast.error);


let container: HTMLDivElement;
let editor: HTMLDivElement;
let rangeRectDescriptor: PropertyDescriptor | undefined;
let root: Root;


function comment(
  id: string,
  body: string,
  resolved = false,
): VaultInlineComment {
  return {
    author_id: null,
    block_id: 'block-1',
    comment: body,
    created_at: '2026-08-29T12:00:00Z',
    id,
    quote: 'Selected passage',
    resolved,
  };
}


function requiredButton(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent.includes(label));
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${label}`);
  }
  return button;
}


function requiredButtonByTitle(title: string): HTMLButtonElement {
  const button = document.body.querySelector(`button[title="${title}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${title}`);
  }
  return button;
}


function requiredTextarea(): HTMLTextAreaElement {
  const textarea = document.body.querySelector(
    'textarea[placeholder="Write a comment…"]',
  );
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('Missing inline-comment textarea');
  }
  return textarea;
}


function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set?.bind(textarea);
  if (!setValue) throw new Error('Missing native textarea value setter');
  act(() => {
    setValue(value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}


function click(element: HTMLElement): void {
  act(() => {
    element.click();
  });
}


async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}


async function renderComments(pageId: string | null = 'page-1'): Promise<void> {
  await act(async () => {
    root.render(<InlineComments pageId={pageId} />);
    await Promise.resolve();
  });
  await flushPromises();
}


function selectEditorText(): void {
  const text = editor.querySelector('[data-id="block-1"]')?.firstChild;
  if (!(text instanceof Text)) throw new Error('Missing editor text');
  const range = document.createRange();
  range.selectNodeContents(text);
  const selection = window.getSelection();
  if (!selection) throw new Error('Missing browser selection');
  selection.removeAllRanges();
  selection.addRange(range);
}


beforeEach(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  apiState.role = 'admin';
  container = document.createElement('div');
  editor = document.createElement('div');
  editor.className = 'ProseMirror';
  editor.innerHTML = '<div class="bn-block" data-id="block-1">Selected passage</div>';
  document.body.append(container, editor);
  root = createRoot(container);
  rangeRectDescriptor = Object.getOwnPropertyDescriptor(
    Range.prototype,
    'getBoundingClientRect',
  );
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(120, 80, 100, 20),
  });
  fetchCommentsMock.mockReset().mockResolvedValue([
    comment('comment-1', 'First comment'),
  ]);
  createCommentMock.mockReset().mockResolvedValue(
    comment('comment-2', 'New comment'),
  );
  updateCommentMock.mockReset().mockResolvedValue(
    comment('comment-1', 'First comment', true),
  );
  deleteCommentMock.mockReset().mockResolvedValue({
    id: 'comment-1',
    status: 'deleted',
  });
  errorToastMock.mockReset();
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  window.getSelection()?.removeAllRanges();
  container.remove();
  editor.remove();
  if (rangeRectDescriptor) {
    Object.defineProperty(
      Range.prototype,
      'getBoundingClientRect',
      rangeRectDescriptor,
    );
  } else {
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  }
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});


describe('InlineComments', () => {
  it('loads comments, toggles the panel and keeps viewers read-only', async () => {
    apiState.role = 'viewer';
    await renderComments();
    expect(fetchCommentsMock).toHaveBeenCalledWith('page-1');

    act(() => {
      emitAppEvent('gnosi:toggle-comments');
    });

    expect(document.body.textContent).toContain('Comments (1)');
    expect(document.body.textContent).toContain('First comment');
    expect(document.body.querySelector('button[title="Resolve"]')).toBeNull();
    expect(document.body.querySelector('button[title="Delete"]')).toBeNull();
  });

  it('captures the selected quote and creates a trimmed comment', async () => {
    fetchCommentsMock.mockResolvedValue([]);
    await renderComments();
    selectEditorText();

    await act(async () => {
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    });

    const addButton = requiredButton('Comment');
    act(() => {
      addButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('«Selected passage»');

    const textarea = requiredTextarea();
    setTextareaValue(textarea, '  New comment  ');
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        ctrlKey: true,
        key: 'Enter',
      }));
    });
    await flushPromises();

    expect(createCommentMock).toHaveBeenCalledWith('page-1', {
      block_id: 'block-1',
      comment: 'New comment',
      quote: 'Selected passage',
    });
    expect(document.body.textContent).toContain('Comments (0)');
  });

  it('resolves and deletes comments through the typed API boundary', async () => {
    await renderComments();
    act(() => {
      emitAppEvent('gnosi:toggle-comments');
    });

    click(requiredButtonByTitle('Resolve'));
    await flushPromises();
    expect(updateCommentMock).toHaveBeenCalledWith(
      'page-1',
      'comment-1',
      { resolved: true },
    );

    click(requiredButtonByTitle('Delete'));
    await flushPromises();
    expect(deleteCommentMock).toHaveBeenCalledWith('page-1', 'comment-1');
  });

  it('reports forbidden mutations with the permission-specific message', async () => {
    updateCommentMock.mockRejectedValue({ status: 403 });
    await renderComments();
    act(() => {
      emitAppEvent('gnosi:toggle-comments');
    });

    click(requiredButtonByTitle('Resolve'));
    await flushPromises();

    expect(errorToastMock).toHaveBeenCalledWith(
      'Your role does not allow modifying comments',
    );
  });
});
