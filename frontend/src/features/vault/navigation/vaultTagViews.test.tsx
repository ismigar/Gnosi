import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TagsModal from './TagsModal';
import { VaultTagsView } from './VaultTagsView';
import { buildTagTree, noteTags } from './vaultTagTree';


const mocks = vi.hoisted(() => ({
  fetchTags: vi.fn(),
}));


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | { defaultValue?: string },
    ) => typeof fallbackOrOptions === 'string'
      ? fallbackOrOptions
      : (fallbackOrOptions?.defaultValue ?? key),
  }),
}));


vi.mock('../../../shared/hooks/useModalKeyboard', () => ({
  useModalKeyboard: vi.fn(),
}));


vi.mock('../../../shared/notifications/notifyError', () => ({ logError: vi.fn() }));


vi.mock('../../../shared/api/vault-tags', () => ({
  fetchVaultTags: mocks.fetchTags,
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;
let resolveTags: ((value: {
  tags: Array<{
    count: number;
    name: string;
    pages: Array<{ id: string; title: string }>;
  }>;
}) => void) | null;


beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.resetAllMocks();
  resolveTags = null;
  mocks.fetchTags.mockImplementation(() => new Promise((resolve) => {
    resolveTags = resolve;
  }));
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});


describe('vault tag views', () => {
  it('normalizes hierarchical tags and accumulates descendant pages', () => {
    const notes = [
      { id: 'page-1', metadata: { tags: ['#work/gnosi'] } },
      { id: 'page-2', metadata: { tags: 'work/research, ideas' } },
    ];
    const firstNote = notes[0];
    if (!firstNote) throw new Error('Tag fixture is empty');
    expect(noteTags(firstNote)).toEqual(['work/gnosi']);
    const tree = buildTagTree(notes);
    expect(tree.children.get('work')?.pages.size).toBe(2);
    expect(tree.children.get('work')?.children.get('gnosi')?.pages.size).toBe(1);
  });

  it('loads API tags, expands a tag, and opens its page', async () => {
    const onPageSelect = vi.fn();
    act(() => {
      root.render(<VaultTagsView onPageSelect={onPageSelect} />);
    });
    const finishTags = resolveTags;
    if (!finishTags) throw new Error('Tags request did not start');
    await act(async () => {
      finishTags({
        tags: [{
          count: 1,
          name: 'research',
          pages: [{ id: 'page-1', title: 'Research note' }],
        }],
      });
      await Promise.resolve();
    });
    const tagButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('research'));
    if (!tagButton) throw new Error('Tag row was not rendered');
    act(() => {
      tagButton.click();
    });
    const pageButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Research note'));
    if (!pageButton) throw new Error('Tag page was not rendered');
    act(() => {
      pageButton.click();
    });
    expect(onPageSelect).toHaveBeenCalledWith('page-1');
  });

  it('selects a hierarchical tag and opens a page from the modal', () => {
    const onClose = vi.fn();
    const onNoteSelect = vi.fn();
    act(() => {
      root.render(
        <TagsModal
          allNotes={[{
            id: 'page-2',
            metadata: { icon: '🧠', tags: ['knowledge/gnosi'] },
            title: 'Gnosi note',
          }]}
          isOpen
          onClose={onClose}
          onNoteSelect={onNoteSelect}
        />,
      );
    });
    const knowledge = [...container.querySelectorAll('div')]
      .find((element) => element.textContent.includes('knowledge')
        && element.className.includes('cursor-pointer'));
    if (!(knowledge instanceof HTMLDivElement)) {
      throw new Error('Hierarchical tag was not rendered');
    }
    act(() => {
      knowledge.click();
    });
    const note = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Gnosi note'));
    if (!note) throw new Error('Tagged page was not rendered');
    act(() => {
      note.click();
    });
    expect(onNoteSelect).toHaveBeenCalledWith('page-2');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
