import { arrayMove } from '@dnd-kit/sortable';
import type { BookmarkSortMode, VaultBookmark } from './bookmarks';

export function groupedBookmarks(entries: readonly VaultBookmark[], mode: BookmarkSortMode) {
  return [...new Set(entries.map((entry) => entry.group))].map((group) => {
    const members = entries.filter((entry) => entry.group === group);
    if (mode === 'alpha-asc' || mode === 'alpha-desc') members.sort((a, b) => (mode === 'alpha-desc' ? -1 : 1) * a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    if (mode === 'recent' || mode === 'oldest') members.sort((a, b) => (mode === 'recent' ? -1 : 1) * ((a.created_at ?? entries.indexOf(a)) - (b.created_at ?? entries.indexOf(b))));
    return { group, entries: members };
  });
}

/** Reorder one group's slots, retaining every other group's relative position. */
export function dragBookmark(entries: readonly VaultBookmark[], activeId: string, overId: string): readonly string[] | null {
  const active = entries.find((entry) => entry.id === activeId);
  const over = entries.find((entry) => entry.id === overId);
  if (!active || !over || activeId === overId || active.group !== over.group) return null;
  const members = entries.filter((entry) => entry.group === active.group).map((entry) => entry.id);
  const moved = arrayMove(members, members.indexOf(activeId), members.indexOf(overId));
  let index = 0;
  return entries.map((entry) => entry.group === active.group ? moved[index++] ?? entry.id : entry.id);
}
