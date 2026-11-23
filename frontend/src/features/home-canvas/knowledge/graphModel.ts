import type { VaultSidebarPageSummary } from '../../../shared/api/vaults';
import type { PersonalNoteEdit } from '../../../shared/records/personalNoteEdits';

export function latestDatedNote(notes: readonly VaultSidebarPageSummary[]): string {
  let latestId = '';
  let latestAt = -Infinity;
  for (const note of notes) {
    const time = Date.parse(note.last_modified);
    if (Number.isFinite(time) && (time > latestAt || (time === latestAt && note.id < latestId))) {
      latestId = note.id;
      latestAt = time;
    }
  }
  return latestId;
}

export function graphNeighbors(
  center: string,
  incoming: readonly string[],
  outgoing: readonly string[],
  notes: ReadonlyMap<string, VaultSidebarPageSummary>,
  edits: readonly PersonalNoteEdit[],
) {
  const times = new Map(edits.map(edit => [edit.id, edit.at]));
  const from = new Set(incoming);
  const to = new Set(outgoing);
  return [...new Set([...from, ...to])].filter(id => id !== center)
    .flatMap(id => {
      const note = notes.get(id);
      return note ? [{ id, title: note.title, incoming: from.has(id), outgoing: to.has(id) }] : [];
    }).sort((left, right) => (times.get(right.id) ?? 0) - (times.get(left.id) ?? 0)
      || left.title.localeCompare(right.title) || left.id.localeCompare(right.id)).slice(0, 5);
}
