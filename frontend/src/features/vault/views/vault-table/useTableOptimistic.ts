import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppEvent } from '../../../../shared/platform/app-events';
import { subscribeAppEvent } from '../../../../shared/platform/app-events';
import { sameCellValue } from '../../properties/cellGridUtils';
import { RELATION_VALUE_APPLIED_EVENT } from '../../properties/relationItemUtils';
import { withResolvedSystemDates } from '../../../../shared/records/model/schemaUtils';
import { normalizeRelationValues as normalizeTableRelations } from '../../properties/relationItemUtils';
import type { TableInputs } from './tableInputs';
import type { MetadataPatch } from './types';
import { useLatestRef } from './useLatestRef';

type Inputs = Pick<TableInputs, 'onCellSaved' | 'onUpdateView' | 'activeView' | 'notes' | 'schema'>;

export function useTableOptimistic({ onCellSaved, onUpdateView, activeView, notes, schema }: Inputs) {
  const [optimisticPatches, setOptimisticPatches] = useState<Map<string, MetadataPatch>>(() => new Map());
  const relationHistoryProtectionRef = useRef<Map<string, number>>(new Map());
  const refreshAfterRelationHistoryRef = useLatestRef<(() => unknown) | null>(() => {
    if (onCellSaved) return onCellSaved();
    if (onUpdateView) return onUpdateView(activeView);
    return undefined;
  });
  useEffect(() => {
    const historyProtection = relationHistoryProtectionRef.current;
    const applyRelationValue = (event: AppEvent<typeof RELATION_VALUE_APPLIED_EVENT>) => {
      const detail = event.detail;
      if (!detail.pageId || !detail.metadataKey) return;
      const protectionKey = `${detail.pageId}::${detail.metadataKey}`;
      const previousTimer = historyProtection.get(protectionKey);
      if (previousTimer) window.clearTimeout(previousTimer);
      setOptimisticPatches(prev => {
        const next = new Map(prev);
        const existing = next.get(detail.pageId) || {};
        next.set(detail.pageId, {
          ...existing,
          [detail.metadataKey]: normalizeTableRelations(detail.value),
        });
        return next;
      });
      const timer = window.setTimeout(() => {
        void (async () => {
          try {
            await refreshAfterRelationHistoryRef.current?.();
          } finally {
            historyProtection.delete(protectionKey);
            setOptimisticPatches(prev => {
              const next = new Map(prev);
              const existing = next.get(detail.pageId);
              if (!existing) return prev;
              const { [detail.metadataKey]: _removed, ...rest } = existing;
              if (Object.keys(rest).length === 0) next.delete(detail.pageId);
              else next.set(detail.pageId, rest);
              return next;
            });
          }
        })();
      }, 4500);
      historyProtection.set(protectionKey, timer);
    };
    const unsubscribe = subscribeAppEvent(RELATION_VALUE_APPLIED_EVENT, (_detail, event) => { applyRelationValue(event); });
    return () => {
      unsubscribe();
      for (const timer of historyProtection.values()) {
        window.clearTimeout(timer);
      }
      historyProtection.clear();
    };
  }, [refreshAfterRelationHistoryRef]);
  const [optimisticTitles, setOptimisticTitles] = useState<Map<string, string>>(() => new Map());
  const rawNotes = useMemo(() => notes, [notes]);
  // Server acknowledgements retire only matching title overrides. Deriving
  // this guarded transition before commit avoids an effect-triggered render
  // without clearing pending edits when stale or unrelated input arrives.
  const acknowledgedTitles = [...optimisticTitles].filter(([id, title]) =>
    rawNotes.some(note => note.id === id && note.title === title));
  if (acknowledgedTitles.length > 0) {
    const pendingTitles = new Map(optimisticTitles);
    for (const [id] of acknowledgedTitles) pendingTitles.delete(id);
    setOptimisticTitles(pendingTitles);
  }
  const safeNotes = useMemo(() => {
    if (optimisticPatches.size === 0 && optimisticTitles.size === 0) return rawNotes;
    return rawNotes.map(n => {
      const patch = optimisticPatches.get(n.id);
      const titleOverride = optimisticTitles.get(n.id);
      if (!patch && titleOverride === undefined) return n;
      return {
        ...n,
        ...(titleOverride !== undefined ? { title: titleOverride } : {}),
        metadata: patch ? { ...(n.metadata || {}), ...patch } : n.metadata,
      };
    });
  }, [rawNotes, optimisticPatches, optimisticTitles]);
  const datedNotes = useMemo(
    () => safeNotes.map(note => withResolvedSystemDates(note, schema)),
    [safeNotes, schema],
  );
  useEffect(() => {
    setOptimisticPatches(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const [noteId, patch] of next) {
        const note = rawNotes.find(n => n.id === noteId);
        if (!note) continue;
        const allMatch = Object.entries(patch).every(
          ([k, v]) => sameCellValue((note.metadata || {})[k], v)
        );
        const isHistoryProtected = Object.keys(patch).some(
          key => relationHistoryProtectionRef.current.has(`${noteId}::${key}`)
        );
        if (allMatch && !isHistoryProtected) {
          next.delete(noteId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rawNotes]);
  return { setOptimisticPatches, setOptimisticTitles, safeNotes, datedNotes };
}
