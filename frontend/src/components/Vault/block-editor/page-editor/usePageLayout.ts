import type { CompactPanel, PageEditorApi } from './types';
import { readStorage, writeStorage, spellEnabledKey, vaultContrastKey, vaultTextSizeKey } from './preferences';
import { subscribeElementEvent } from '../../../../shared/platform/browser-events';
import { subscribeAppEvent, subscribeAppSignal } from '../../../../shared/platform/app-events';
import { autoGrowTextarea } from '../domSizing';
import { getScrollableAncestor } from '../domSizing';
import { toast } from '../../../../lib/toast';
import { useCallback } from 'react';
import { useEffect } from 'react';
import type { usePageEditorState } from './usePageEditorState';
type Input = Pick<ReturnType<typeof usePageEditorState>, 'spellEnabled' | 'metadataRef' | 'metadata' | 'contentRef' | 'setContentWidth' | 'editorApiRef' | 'compactPanelCloseTimerRef' | 'setCompactPanelPreview' | 'setIsPropertiesOpen' | 'setIsLinksInfoOpen' | 'headerHoverRef' | 'setIsPageHeaderCompact' | 'noteFilename' | 'setIsFocusMode' | 'titleInputRef' | 'historyOpenSignal' | 'setIsHistoryOpen' | 't'>;
export function usePageLayout(state: Input) {
  const { spellEnabled, metadataRef, metadata, contentRef, setContentWidth, editorApiRef, compactPanelCloseTimerRef, setCompactPanelPreview, setIsPropertiesOpen, setIsLinksInfoOpen, headerHoverRef, setIsPageHeaderCompact, noteFilename, setIsFocusMode, titleInputRef, historyOpenSignal, setIsHistoryOpen, t } = state;

  useEffect(() => { writeStorage(spellEnabledKey, spellEnabled ? '1' : '0'); }, [spellEnabled]);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata, metadataRef]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContentWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, [contentRef, setContentWidth]);

  const registerEditorApi = useCallback((api: PageEditorApi | null) => { editorApiRef.current = api; }, [editorApiRef]);

  const clearCompactPanelCloseTimer = useCallback(() => {
    if (compactPanelCloseTimerRef.current) {
      window.clearTimeout(compactPanelCloseTimerRef.current);
      compactPanelCloseTimerRef.current = null;
    }
  }, [compactPanelCloseTimerRef]);

  const openCompactPanelPreview = useCallback((panel: CompactPanel) => {
    clearCompactPanelCloseTimer();
    setCompactPanelPreview(panel);
  }, [clearCompactPanelCloseTimer, setCompactPanelPreview]);

  const scheduleCompactPanelPreviewClose = useCallback(() => {
    clearCompactPanelCloseTimer();
    compactPanelCloseTimerRef.current = window.setTimeout(() => {
      setCompactPanelPreview(null);
      compactPanelCloseTimerRef.current = null;
    }, 120);
  }, [clearCompactPanelCloseTimer, compactPanelCloseTimerRef, setCompactPanelPreview]);

  const scrollPageToTop = useCallback(() => {
    const scroller = getScrollableAncestor(contentRef.current);
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      scroller.scrollTop = 0;
    }
  }, [contentRef]);

  const toggleCompactPanel = useCallback((panel: CompactPanel) => {
    if (panel === 'properties') {
      setIsPropertiesOpen((current) => !current);
    } else {
      setIsLinksInfoOpen((current) => !current);
    }
    scrollPageToTop();
  }, [scrollPageToTop, setIsLinksInfoOpen, setIsPropertiesOpen]);

  useEffect(() => () => { clearCompactPanelCloseTimer(); }, [clearCompactPanelCloseTimer]);

  useEffect(() => {
    const hero = headerHoverRef.current;
    const content = contentRef.current;
    if (!hero || !content || typeof IntersectionObserver !== 'function') return undefined;
    let scrollRoot = hero.parentElement;
    while (scrollRoot) {
      const overflowY = window.getComputedStyle(scrollRoot).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scrollRoot = scrollRoot.parentElement;
    }
    const hasScrolledTable = () => [...content.querySelectorAll('[data-vault-table-scroll]')]
      .some((element) => element.scrollTop > 0);
    const heroHasLeftDocumentScroller = () => {
      const heroRect = hero.getBoundingClientRect();
      const rootTop = scrollRoot?.getBoundingClientRect().top || 0;
      return heroRect.bottom < rootTop;
    };
    const syncCompactHeader = () => {
      setIsPageHeaderCompact(heroHasLeftDocumentScroller() || hasScrolledTable());
    };
    const handleNestedScroll = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.matches('[data-vault-table-scroll]')) {
        syncCompactHeader();
      }
    };
    const observer = new IntersectionObserver(
      () => { syncCompactHeader(); },
      { root: scrollRoot, threshold: 0 },
    );
    observer.observe(hero);
    const stopRoot = scrollRoot ? subscribeElementEvent(scrollRoot, 'scroll', syncCompactHeader, { passive: true }) : undefined;
    const stopNested = subscribeElementEvent(content, 'scroll', handleNestedScroll, { capture: true, passive: true });
    syncCompactHeader();
    return () => {
      observer.disconnect();
      stopRoot?.();
      stopNested();
    };
  }, [contentRef, headerHoverRef, noteFilename, setIsPageHeaderCompact]);

  useEffect(() => {
    const toggleFocusMode = () => { setIsFocusMode((current) => !current); };
    const stop = subscribeAppSignal('gnosi:toggle-focus-mode', toggleFocusMode);
    try {
      document.documentElement.dataset.vaultContrast = readStorage(vaultContrastKey) || 'normal';
      document.documentElement.dataset.vaultText = readStorage(vaultTextSizeKey) || 'normal';
    } catch { /* noop */ }
    return stop;
  }, [setIsFocusMode]);


  useEffect(() => {
    autoGrowTextarea(titleInputRef.current);
  }, [metadata.title, titleInputRef]);


  useEffect(() => {
    if (historyOpenSignal > 0) {
      setIsHistoryOpen(true);
    }
  }, [historyOpenSignal, setIsHistoryOpen]);


  // Listen for optimistic-concurrency conflicts from the etag interceptor.
  // The backend returns 409 with `etag_mismatch` when the .md on disk has
  // changed since this client GET'd it (typical case in personal mode:
  // user edited the same note on the phone and OneDrive synced). We show a
  // non-destructive toast offering to reload — never auto-overwrite.
  useEffect(() => {
    const handler = ({ pageId, message }: import("../../../../shared/platform/app-events").PageEtagConflictEventDetail) => {
      // Ignore conflicts for other pages (other tabs etc.)
      if (pageId && pageId !== noteFilename) return;
      toast.error(
        message || t('editor.file_changed_externally'),
        {
          duration: 8000,
          id: `etag-conflict-${noteFilename}`,
        },
      );
    };
    return subscribeAppEvent('pageEtagConflict', handler);
  }, [noteFilename, t]);
  return { registerEditorApi, clearCompactPanelCloseTimer, openCompactPanelPreview, scheduleCompactPanelPreviewClose, scrollPageToTop, toggleCompactPanel };
}
