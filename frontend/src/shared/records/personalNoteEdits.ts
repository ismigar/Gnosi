import type { RequestContext } from '../api/request-context';
import { defineStorageKey, readStorage, stringStorageCodec, writeStorage } from '../platform/browser-storage';
import { subscribeWindowEvent } from '../platform/browser-events';
import { isAppContent, isCalendarPage } from './model/schemaUtils';
import { isDashboardPage } from './model/pageKind';

interface NoteCandidate {
  readonly id: string;
  readonly is_database?: boolean | null;
  readonly folder?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface PersonalNoteEdit {
  readonly id: string;
  readonly at: number;
}

export function isKnowledgeNote(page: NoteCandidate): boolean {
  const metadata = page.metadata;
  return Boolean(page.id) && !page.is_database && !isDashboardPage(page)
    && !isCalendarPage(page) && (!isAppContent({ folder: page.folder }) || page.folder?.startsWith('BD/') === true)
    && metadata?.is_database !== true && metadata?.is_template !== true
    && metadata?.is_drawing !== true && metadata?.is_canvas !== true;
}

function historyKey(scope: RequestContext) {
  const actor = scope.userId === 'ismael-legacy' && scope.userEmail ? scope.userEmail : scope.userId;
  const identity = JSON.stringify([scope.workspaceId, scope.vaultId, actor]);
  return defineStorageKey(`gnosi:personal-note-edits:v1:${identity}`, stringStorageCodec);
}

export function personalEditsSnapshot(scope: RequestContext): string {
  return scope.vaultId ? readStorage(historyKey(scope)) ?? '[]' : '[]';
}

export function parsePersonalEdits(snapshot: string): PersonalNoteEdit[] {
  try {
    const value: unknown = JSON.parse(snapshot);
    if (!Array.isArray(value)) return [];
    return value.filter((item: unknown): item is PersonalNoteEdit => item !== null && typeof item === 'object'
      && 'id' in item && typeof item.id === 'string' && 'at' in item && typeof item.at === 'number' && Number.isFinite(item.at));
  } catch { return []; }
}

const listeners = new Set<(key: string) => void>();
export function subscribePersonalEdits(notify: () => void, scope: RequestContext) {
  const key = historyKey(scope).name;
  const onSave = (changed: string) => { if (changed === key) notify(); };
  listeners.add(onSave);
  const stopStorage = subscribeWindowEvent('storage', event => { if (!event.key || event.key === key) notify(); });
  return () => { listeners.delete(onSave); stopStorage(); };
}

/** Scope-bound writes may finish after switching Vaults. Keep the originating account and the actual edit time. */
export function recordPersonalNoteEdit(scope: RequestContext, page: NoteCandidate | undefined, editedAt?: number): void {
  if (typeof window === 'undefined' || editedAt === undefined || !scope.vaultId || !page || !isKnowledgeNote(page)) return;
  const key = historyKey(scope);
  const save = () => {
    const edits = parsePersonalEdits(personalEditsSnapshot(scope));
    if (edits.some(edit => edit.id === page.id && edit.at >= editedAt)) return;
    const next = [{ id: page.id, at: editedAt }, ...edits.filter(edit => edit.id !== page.id)]
      .sort((left, right) => right.at - left.at);
    if (writeStorage(key, JSON.stringify(next))) listeners.forEach(notify => { notify(key.name); });
  };
  // Browser tabs can save different notes at the same time under the same account.
  const browser: { readonly locks?: LockManager } = navigator;
  if (browser.locks) void browser.locks.request(key.name, save).catch(save);
  else save();
}
