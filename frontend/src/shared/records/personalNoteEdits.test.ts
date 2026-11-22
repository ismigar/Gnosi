import { afterEach, beforeEach, expect, it } from 'vitest';
import { currentRequestContext, USER_ID_STORAGE_KEY, VAULT_ID_STORAGE_KEY } from '../api/request-context';
import { listStorageKeyNames, defineStorageKey, removeStorage, stringStorageCodec, writeStorage } from '../platform/browser-storage';
import { isKnowledgeNote, parsePersonalEdits, personalEditsSnapshot, recordPersonalNoteEdit } from './personalNoteEdits';

beforeEach(() => {
  writeStorage(USER_ID_STORAGE_KEY, 'member');
  writeStorage(VAULT_ID_STORAGE_KEY, 'vault-a');
});
afterEach(() => {
  removeStorage(USER_ID_STORAGE_KEY);
  removeStorage(VAULT_ID_STORAGE_KEY);
  for (const key of listStorageKeyNames('local', 'gnosi:personal-note-edits:')) removeStorage(defineStorageKey(key, stringStorageCodec));
});

it('keeps only confirmed local changes, in edit order, across vault and account switches', () => {
  const scope = currentRequestContext();
  recordPersonalNoteEdit(scope, { id: 'initial-load' });
  recordPersonalNoteEdit(scope, { id: 'a' }, 500);
  recordPersonalNoteEdit(scope, { id: 'a' }, 490);
  recordPersonalNoteEdit(scope, { id: 'b' }, 520);
  recordPersonalNoteEdit(scope, { id: 'c' }, 480);
  expect(parsePersonalEdits(personalEditsSnapshot(scope))).toEqual([{ id: 'b', at: 520 }, { id: 'a', at: 500 }, { id: 'c', at: 480 }]);
  writeStorage(VAULT_ID_STORAGE_KEY, 'vault-b');
  recordPersonalNoteEdit(scope, { id: 'delayed-a' }, 600);
  expect(parsePersonalEdits(personalEditsSnapshot(currentRequestContext()))).toEqual([]);
  writeStorage(VAULT_ID_STORAGE_KEY, 'vault-a'); writeStorage(USER_ID_STORAGE_KEY, 'other');
  expect(parsePersonalEdits(personalEditsSnapshot(currentRequestContext()))).toEqual([]);
  expect(parsePersonalEdits(personalEditsSnapshot(scope)).map(edit => edit.id)).toEqual(['delayed-a', 'b', 'a', 'c']);
});

it('excludes dashboards, app-only documents and templates', () => {
  for (const page of [{ folder: 'Dashboard/Archives' }, { folder: 'Mail/Inbox' }, { folder: 'Calendar/2026' }, { metadata: { is_dashboard: true } }, { metadata: { is_template: true } }]) {
    expect(isKnowledgeNote({ id: 'id', ...page })).toBe(false);
  }
  expect(isKnowledgeNote({ id: 'document', folder: 'Wiki' })).toBe(true);
});

it('tolerates unrecognized local history formats', () => {
  expect(parsePersonalEdits('corrupt')).toEqual([]);
  expect(parsePersonalEdits('[null, {}, {"id":"x","at":"today"}]')).toEqual([]);
});
