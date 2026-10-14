import { describe, expect, it } from 'vitest';

import { isBookmark, loadBookmarks, moveBookmark, saveBookmarks, type VaultBookmark } from './bookmarks';

const base: VaultBookmark = { id: 'one', label: 'Research', group: 'Study', kind: 'page', target: 'page-one' };

describe('scoped bookmarks', () => {
  it('supports safe page, section, search, graph and web targets', () => {
    expect(isBookmark(base)).toBe(true);
    expect(isBookmark({ ...base, kind: 'section', target: 'page-one#^passage' })).toBe(true);
    expect(isBookmark({ ...base, kind: 'search', target: 'task-todo:write' })).toBe(true);
    expect(isBookmark({ ...base, kind: 'graph', target: '/@research/graph?focus=one' })).toBe(true);
    expect(isBookmark({ ...base, kind: 'url', target: 'https://example.com' })).toBe(true);
    expect(isBookmark({ ...base, kind: 'url', target: 'javascript:alert(1)' })).toBe(false);
    expect(isBookmark({ ...base, kind: 'graph', target: '//outside.example/graph' })).toBe(false);
  });
  it('isolates Vaults, preserves grouping and rejects duplicate IDs without replacing saved data', () => {
    expect(saveBookmarks('synthetic-a', [base])).toBe(true);
    expect(loadBookmarks('synthetic-b')).toEqual([]);
    expect(loadBookmarks('synthetic-a')).toEqual([base]);
    expect(saveBookmarks('synthetic-a', [base, base])).toBe(false);
    expect(loadBookmarks('synthetic-a')).toEqual([base]);
    saveBookmarks('synthetic-a', []);
  });
  it('reorders within a group while retaining other groups', () => {
    const other = { ...base, id: 'other', group: 'Work' };
    const last = { ...base, id: 'last' };
    expect(moveBookmark([base, other, last], base.id, 1)).toEqual([last, other, base]);
    expect(moveBookmark([base], base.id, -1)).toEqual([base]);
  });
});
