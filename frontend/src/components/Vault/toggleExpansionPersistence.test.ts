import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineStorageKey, readStorage, stringStorageCodec } from '../../shared/platform/browser-storage';
import { resetApiTestStorage, writeApiTestStorage } from '../../test/api-request';
import {
  restoreToggleDomExpansionState,
  restoreToggleExpansionState,
  saveToggleDomExpansionState,
  saveToggleExpansionState,
} from './toggleExpansionStateUtils';

const blocks = [
  { id: 'new-open', type: 'toggleListItem', content: ' Notes 🧠 ', children: [] },
  { id: 'new-closed', type: 'toggleListItem', content: 'Closed', children: [] },
];

afterEach(() => { resetApiTestStorage(); });

function readValue(name: string) {
  return readStorage(defineStorageKey(name, stringStorageCodec));
}

function toggleRoot() {
  const root = document.createElement('div');
  root.innerHTML = '<div class="bn-toggle-wrapper" data-show-children="false"><button class="bn-toggle-button">Open</button></div><div class="bn-toggle-wrapper" data-show-children="true"><button class="bn-toggle-button">Close</button></div>';
  return root;
}

describe('typed toggle persistence compatibility', () => {
  it('preserves default browser keys, JSON, trimming and exact true-string semantics', () => {
    writeApiTestStorage('toggle-new-open', 'true');
    writeApiTestStorage('toggle-new-closed', 'TRUE');
    saveToggleExpansionState('page-1', blocks);
    expect(readValue('gnosi.vault.toggle-expansion.page-1'))
      .toBe('{"0:Notes 🧠":true,"1:Closed":false}');
    writeApiTestStorage('toggle-new-open', 'false');
    writeApiTestStorage('toggle-new-closed', 'true');
    restoreToggleExpansionState('page-1', blocks);
    expect(readValue('toggle-new-open')).toBe('true');
    expect(readValue('toggle-new-closed')).toBe('false');
  });

  it('keeps legacy truthy values and ignores absent structural keys', () => {
    writeApiTestStorage('gnosi.vault.toggle-expansion.page-1', '{"0:Notes 🧠":"false"}');
    writeApiTestStorage('toggle-new-closed', 'keep');
    restoreToggleExpansionState('page-1', blocks);
    expect(readValue('toggle-new-open')).toBe('true');
    expect(readValue('toggle-new-closed')).toBe('keep');
  });

  it.each(['{', 'null', 'false', '"text"'])(
    'does not replace block state from an invalid snapshot: %s', (snapshot) => {
      writeApiTestStorage('gnosi.vault.toggle-expansion.page-1', snapshot);
      writeApiTestStorage('toggle-new-open', 'keep');
      restoreToggleExpansionState('page-1', blocks);
      expect(readValue('toggle-new-open')).toBe('keep');
    },
  );

  it('never overwrites a saved snapshot if any block state cannot be read', () => {
    const setItem = vi.fn();
    const storage = {
      getItem: (key: string) => {
        if (key === 'toggle-new-closed') throw new Error('Read denied');
        return 'true';
      },
      setItem,
    };
    expect(() => { saveToggleExpansionState('page-1', blocks, storage); }).not.toThrow();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('tolerates write quota failures and explicitly unavailable storage', () => {
    const storage = {
      getItem: () => '{"0:Notes 🧠":true}',
      setItem: () => { throw new Error('Quota exceeded'); },
    };
    const root = toggleRoot();
    expect(() => { restoreToggleExpansionState('page-1', blocks, storage); }).not.toThrow();
    expect(() => { saveToggleExpansionState('page-1', blocks, storage); }).not.toThrow();
    expect(() => { saveToggleDomExpansionState('page-1', root, storage); }).not.toThrow();
    expect(() => { restoreToggleExpansionState('page-1', blocks, null); }).not.toThrow();
    expect(() => { saveToggleExpansionState('page-1', blocks, null); }).not.toThrow();
    expect(() => { restoreToggleDomExpansionState('page-1', root, null); }).not.toThrow();
    expect(() => { saveToggleDomExpansionState('page-1', root, null); }).not.toThrow();
  });

  it('preserves positional DOM snapshots and only opens saved-open wrappers', () => {
    const root = toggleRoot();
    saveToggleDomExpansionState('page-1', root);
    expect(readValue('gnosi.vault.toggle-dom-expansion.page-1')).toBe('[false,true]');
    writeApiTestStorage('gnosi.vault.toggle-dom-expansion.page-1', '[true,false]');
    const clicks = vi.fn();
    root.addEventListener('click', clicks);
    restoreToggleDomExpansionState('page-1', root);
    expect(clicks).toHaveBeenCalledOnce();
    expect(clicks.mock.calls[0]?.[0]).toHaveProperty('target', root.querySelector('button'));
    expect(root.children[1]?.getAttribute('data-show-children')).toBe('true');
  });

  it.each(['{', 'null', '{}', '"text"'])(
    'ignores malformed or wrong-shaped DOM snapshots: %s', (snapshot) => {
      writeApiTestStorage('gnosi.vault.toggle-dom-expansion.page-1', snapshot);
      const root = toggleRoot();
      const clicks = vi.fn();
      root.addEventListener('click', clicks);
      restoreToggleDomExpansionState('page-1', root);
      expect(clicks).not.toHaveBeenCalled();
    },
  );
});
