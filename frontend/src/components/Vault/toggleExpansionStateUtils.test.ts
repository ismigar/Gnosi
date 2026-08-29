import { describe, expect, it } from 'vitest';

import {
  restoreToggleDomExpansionState,
  restoreToggleExpansionState,
  saveToggleDomExpansionState,
  saveToggleExpansionState,
} from './toggleExpansionStateUtils';

interface TestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function createStorage(
  values: Readonly<Record<string, string>> = {},
): TestStorage {
  const data = new Map(Object.entries(values));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('toggle expansion state', () => {
  it('restores an open toggle after its editor assigns a new block id', () => {
    const storage = createStorage();
    const initialBlocks = [
      {
        id: 'old-notes',
        type: 'toggleListItem',
        content: [{ type: 'text', text: 'Notes' }],
        children: [
          {
            id: 'old-index',
            type: 'toggleListItem',
            content: [{ type: 'text', text: 'Notes índex' }],
            children: [],
          },
        ],
      },
    ];
    storage.setItem('toggle-old-notes', 'true');
    storage.setItem('toggle-old-index', 'true');
    saveToggleExpansionState('page-1', initialBlocks, storage);

    const remountedBlocks = [
      {
        id: 'new-notes',
        type: 'toggleListItem',
        content: [{ type: 'text', text: 'Notes' }],
        children: [
          {
            id: 'new-index',
            type: 'toggleListItem',
            content: [{ type: 'text', text: 'Notes índex' }],
            children: [],
          },
        ],
      },
    ];
    restoreToggleExpansionState('page-1', remountedBlocks, storage);

    expect(storage.getItem('toggle-new-notes')).toBe('true');
    expect(storage.getItem('toggle-new-index')).toBe('true');
  });

  it('does not apply a saved state to a different toggle structure', () => {
    const storage = createStorage({
      'gnosi.vault.toggle-expansion.page-1': JSON.stringify({
        '0:Notes': true,
      }),
    });
    const blocks = [
      {
        id: 'new-toggle',
        type: 'toggleListItem',
        content: [{ type: 'text', text: 'Other section' }],
        children: [],
      },
    ];

    restoreToggleExpansionState('page-1', blocks, storage);

    expect(storage.getItem('toggle-new-toggle')).toBeNull();
  });

  it('restores open toggle wrappers after the editor remounts', () => {
    const storage = createStorage();
    const source = document.createElement('div');
    source.innerHTML =
      '<div class="bn-toggle-wrapper" data-show-children="true"></div><div class="bn-toggle-wrapper" data-show-children="true"></div>';
    saveToggleDomExpansionState('page-1', source, storage);

    const remounted = document.createElement('div');
    remounted.innerHTML =
      '<div class="bn-toggle-wrapper" data-show-children="false"><button class="bn-toggle-button"></button></div><div class="bn-toggle-wrapper" data-show-children="false"><button class="bn-toggle-button"></button></div>';
    remounted.querySelectorAll('.bn-toggle-button').forEach((button) => {
      button.addEventListener('click', () => {
        const parent = button.parentElement;
        if (!parent) throw new Error('Expected a toggle wrapper parent.');
        parent.setAttribute('data-show-children', 'true');
      });
    });

    restoreToggleDomExpansionState('page-1', remounted, storage);

    expect(
      Array.from(
        remounted.querySelectorAll('.bn-toggle-wrapper'),
      ).every(
        (wrapper) =>
          wrapper.getAttribute('data-show-children') === 'true',
      ),
    ).toBe(true);
  });
});
