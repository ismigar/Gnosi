import { useCallback, useRef, useState } from 'react';
import type { ComposerResult } from '../../../../../shared/api/vault-composer';
import { adoptPageEtag } from '../../../../../shared/api/page-etag';
import type { usePageEditorState } from './usePageEditorState';
import type { usePageMetadata } from './usePageMetadata';
import type { PageUpdate } from './types';
import { inFlightSaves } from '../../editorState';

type Input = ReturnType<typeof usePageEditorState> & ReturnType<typeof usePageMetadata>;
interface ContentOverride { noteFilename: string; parentContent: unknown; content: string }

export function useNoteComposer(state: Input) {
  const { isEditor, metadataRef, metaSaveTimerRef, metaSaveInFlightRef, pendingRemoveKeysRef, _doSaveMetadata,
    noteFilename, initialContent, onUpdate, onRefreshNotes, pageActions } = state;
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerLocked, setComposerLocked] = useState(false);
  const [contentOverride, setContentOverride] = useState<ContentOverride | null>(null);
  // Keep a completed edit visible while its parent catches up. Any later parent
  // revision becomes authoritative, including a return to the original content.
  if (contentOverride && (contentOverride.noteFilename !== noteFilename || contentOverride.parentContent !== initialContent)) {
    setContentOverride(null);
  }
  const composedContent = contentOverride?.content;
  const [composerRevision, setComposerRevision] = useState(0);
  const closeComposer = useCallback(() => { setComposerOpen(false); setComposerLocked(false); }, []);
  const lockComposer = useCallback(() => { setComposerLocked(true); }, []);
  const updateComposedPage = useCallback<PageUpdate>((id, content, patch) => {
    if (id === noteFilename && typeof content === 'string') setContentOverride({ noteFilename, parentContent: initialContent, content });
    onUpdate?.(id, content, patch);
  }, [noteFilename, initialContent, onUpdate]);
  const registerSave = useCallback((save: (() => Promise<boolean>) | null) => { saveRef.current = save; }, []);
  const flushForComposer = useCallback(async () => {
    if (!isEditor || !saveRef.current || !await saveRef.current()) return false;
    inFlightSaves.delete(noteFilename);
    const pendingMetadata = Boolean(metaSaveTimerRef.current);
    if (metaSaveTimerRef.current) clearTimeout(metaSaveTimerRef.current);
    metaSaveTimerRef.current = null;
    for (let attempt = 0; attempt < 5 && metaSaveInFlightRef.current; attempt += 1) {
      if (!await metaSaveInFlightRef.current) return false;
    }
    if (metaSaveInFlightRef.current) return false;
    return !pendingMetadata || await _doSaveMetadata(metadataRef.current, pendingRemoveKeysRef.current);
  }, [_doSaveMetadata, isEditor, metaSaveInFlightRef, metaSaveTimerRef, metadataRef, noteFilename, pendingRemoveKeysRef]);
  const finishComposition = useCallback((result: ComposerResult) => {
    const source = result.changes.find(change => change.id === noteFilename);
    if (source) {
      adoptPageEtag(noteFilename, source.etag);
      setContentOverride({ noteFilename, parentContent: initialContent, content: source.after });
      setComposerRevision(value => value + 1);
      onUpdate?.(noteFilename, source.after);
    }
    onRefreshNotes();
    setComposerOpen(false);
    setComposerLocked(false);
  }, [noteFilename, initialContent, onRefreshNotes, onUpdate]);
  return {
    registerSave, composerOpen, composerLocked, closeComposer, lockComposer, flushForComposer, finishComposition, composedContent, composerRevision,
    onUpdate: updateComposedPage,
    pageActions: { ...pageActions, canComposeNote: isEditor, onComposeNote: () => { setComposerOpen(true); } },
  };
}
