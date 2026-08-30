import type { ChangeEvent } from 'react';
import type { PageMetadata, PagePatch, SaveMetadataOptions } from './types';
import { relationInput } from './valueBoundaries';
import { subscribeAppEvent } from '../../../../shared/platform/app-events';
import { RELATION_VALUE_APPLIED_EVENT } from '../../relationItemUtils';
import { announceRelationUnlinked } from '../../relationItemUtils';
import { normalizeRelationValues } from '../../relationItemUtils';
import { notifyError } from '../../../../lib/notifyError';
import { patchVaultPage } from '../../../../shared/api/vaults';
import { useCallback } from 'react';
import { useEffect } from 'react';
import { withoutRelationValue } from '../../relationItemUtils';
import type { usePageEditorState } from './usePageEditorState';
type Input = Pick<ReturnType<typeof usePageEditorState>, 'noteFilename' | 'metaSaveInFlightRef' | 'pendingMetaRef' | 'pendingRemoveKeysRef' | 'setSaveStatus' | 't' | 'metadata' | 'onUpdate' | 'metadataRef' | 'metaSaveTimerRef' | 'setMetadata' | 'onUpdatePageMetadata'>;
export function usePageMetadata(state: Input) {
  const { noteFilename, metaSaveInFlightRef, pendingMetaRef, pendingRemoveKeysRef, setSaveStatus, t, metadata, onUpdate, metadataRef, metaSaveTimerRef, setMetadata, onUpdatePageMetadata } = state;

  const _doSaveMetadata = useCallback(async function saveMetadata(currentMetadata: PageMetadata, removeKeys: string[] | null = null): Promise<boolean> {
    if (!noteFilename) return false;
    // If a save is already in flight, coalesce: keep only the most recent
    // snapshot and let the running request finish first.
    if (metaSaveInFlightRef.current) {
      pendingMetaRef.current = currentMetadata;
      pendingRemoveKeysRef.current = removeKeys;
      return metaSaveInFlightRef.current;
    }
    const runSave = async (meta: PageMetadata, keys: string[] | null) => {
      setSaveStatus('saving');
      try {
        const data: PagePatch & { remove_metadata_keys?: string[] } = {
          title: meta.title || t('editor.untitled'),
          metadata: meta
        };
        // The PATCH merges on the backend; to REMOVE keys (properties
        // local/ad-hoc) they must be sent explicitly.
        if (keys && keys.length) data.remove_metadata_keys = keys;
        await patchVaultPage(noteFilename, data);
        setSaveStatus('saved');
        // Notifies the parent so that `tabs[i].title` and the breadcrumb
        // follow the rename. Without this, title changes via the
        // properties panel or header input would stay local to the
        // editor. The parent owns the optimistic page and table caches,
        // so a full page-list refresh is neither needed nor safe here.
        if (onUpdate) onUpdate(noteFilename, undefined, { title: data.title, metadata: data.metadata });
        setTimeout(() => { setSaveStatus(prev => prev === 'saved' ? 'idle' : prev); }, 3000);
        return true;
      } catch (err) {
        // Metadata-save failures used to be silent (console.error only).
        // They mean a property edit, title rename, or icon/cover change
        // didn't persist — important for the user to know. The UI error
        // badge still shows; we add a deduplicated toast so the user
        // doesn't think the change was saved.
        notifyError('save-metadata', err, t('editor.markdown_save_error'));
        setSaveStatus('error');
        return false;
      }
    };
    const promise = runSave(currentMetadata, removeKeys).finally(async () => {
      // Flush the latest coalesced snapshot, if any, then clear state.
      const pending = pendingMetaRef.current;
      const pendingKeys = pendingRemoveKeysRef.current;
      pendingMetaRef.current = null;
      pendingRemoveKeysRef.current = null;
      metaSaveInFlightRef.current = null;
      if (pending) {
        metaSaveInFlightRef.current = saveMetadata(pending, pendingKeys);
        await metaSaveInFlightRef.current;
      }
    });
    metaSaveInFlightRef.current = promise;
    return promise;
  }, [metaSaveInFlightRef, noteFilename, onUpdate, pendingMetaRef, pendingRemoveKeysRef, setSaveStatus, t]);

  const handleSaveMetadata = useCallback((updatedMetadata?: PageMetadata, options: SaveMetadataOptions = {}) => {
    const currentMetadata = updatedMetadata || metadataRef.current;
    if (options.immediate) {
      if (metaSaveTimerRef.current) clearTimeout(metaSaveTimerRef.current);
      metaSaveTimerRef.current = null;
      void _doSaveMetadata(currentMetadata, options.removeKeys || null);
      return;
    }
    if (metaSaveTimerRef.current) clearTimeout(metaSaveTimerRef.current);
    metaSaveTimerRef.current = setTimeout(() => {
      metaSaveTimerRef.current = null;
      void _doSaveMetadata(currentMetadata, options.removeKeys || null);
    }, 600);
  }, [_doSaveMetadata, metaSaveTimerRef, metadataRef]);


  // Flush any pending debounced save when the note changes or the editor
  // unmounts — otherwise the user's last keystroke can be lost.
  useEffect(() => {
    return () => {
      if (metaSaveTimerRef.current) {
        clearTimeout(metaSaveTimerRef.current);
        metaSaveTimerRef.current = null;
        // Best-effort flush of the latest metadata snapshot.
        void _doSaveMetadata(metadataRef.current);
      }
    };
  }, [noteFilename, _doSaveMetadata, metaSaveTimerRef, metadataRef]);


  const handleTitleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const nextTitle = e.target.value;
    const nextMeta = { ...metadata, title: nextTitle };
    setMetadata(nextMeta);
    onUpdate?.(noteFilename, undefined, { title: nextTitle, metadata: nextMeta });
    handleSaveMetadata(nextMeta);
  };

  const handleMetaChange = (key: string, value: unknown) => {
    const nextMeta = { ...metadata, [key]: value };
    setMetadata(nextMeta);
    // Icon and cover are discrete actions (a single click): skip the
    // debounce and immediately updates the sidebar with an optimistic patch
    // so the new icon appears immediately in the sidebar.
    const isDiscrete = key === 'icon' || key === 'cover';
    if (isDiscrete && onUpdatePageMetadata && noteFilename) {
      onUpdatePageMetadata(noteFilename, { [key]: value });
    }
    handleSaveMetadata(nextMeta, isDiscrete ? { immediate: true } : undefined);
  };

  const handleRelationRemove = useCallback(async (key: string, relationId: string, relatedMap?: Readonly<Record<string, string>>) => {
    const previousMetadata = metadataRef.current;
    const previousValue = normalizeRelationValues(relationInput(previousMetadata[key]));
    const nextValue = withoutRelationValue(previousValue, relationId);
    if (nextValue.length === previousValue.length) return false;

    if (metaSaveTimerRef.current) {
      clearTimeout(metaSaveTimerRef.current);
      metaSaveTimerRef.current = null;
    }

    const nextMetadata = { ...previousMetadata, [key]: nextValue };
    metadataRef.current = nextMetadata;
    setMetadata(nextMetadata);
    const saved = await _doSaveMetadata(nextMetadata);
    if (!saved) {
      metadataRef.current = previousMetadata;
      setMetadata(previousMetadata);
      return false;
    }

    announceRelationUnlinked({
      pageId: noteFilename,
      field: key,
      metadataKey: key,
      relationId,
      relationTitle: relatedMap?.[relationId] || relationId,
      previousValue,
      nextValue,
    });
    return true;
  }, [_doSaveMetadata, metaSaveTimerRef, metadataRef, noteFilename, setMetadata]);


  useEffect(() => {
    const applyRelationValue = (detail: import("../../../../shared/platform/app-events").RelationValueAppliedEventDetail) => {
      if ((detail.pageId || '') !== (noteFilename || '') || !detail.metadataKey) return;
      const nextMetadata = {
        ...metadataRef.current,
        [detail.metadataKey]: normalizeRelationValues(relationInput(detail.value)),
      };
      metadataRef.current = nextMetadata;
      setMetadata(nextMetadata);
      setSaveStatus('saved');
    };
    return subscribeAppEvent(RELATION_VALUE_APPLIED_EVENT, applyRelationValue);
  }, [metadataRef, noteFilename, setMetadata, setSaveStatus]);


  // Removing a property is a structural change → save immediately so the
  // server-side state can never have a "stale" property removed only
  // locally if the user navigates away within 600ms.
  const handleRemoveProperty = (key: string) => { const { [key]: _removed, ...nextMeta } = metadata; setMetadata(nextMeta); handleSaveMetadata(nextMeta, { immediate: true, removeKeys: [key] }); };
  return { _doSaveMetadata, handleSaveMetadata, handleTitleChange, handleMetaChange, handleRelationRemove, handleRemoveProperty };
}
