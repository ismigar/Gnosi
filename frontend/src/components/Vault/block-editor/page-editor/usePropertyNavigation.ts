import type { KeyboardEvent } from 'react';
import type { PropertyEntry } from './types';
import { coercePageProperty, type PageCoercionContext } from './propertyCoercion';
import { writeClipboardText } from '../../../../shared/platform/clipboard';
import { subscribeWindowEvent } from '../../../../shared/platform/browser-events';
import { focusPropertyRow } from '../../propertyNavigationUtils';
import { parseClipboardMatrix } from '../../cellGridUtils';
import { serializeCellForClipboard } from '../../cellGridUtils';
import { toast } from '../../../../lib/toast';
import { useCallback } from 'react';
import { useEffect } from 'react';
import type { usePageProperties } from './usePageProperties';
import type { usePageEditorState } from './usePageEditorState';
import type { usePageMetadata } from './usePageMetadata';
type Input = Pick<ReturnType<typeof usePageProperties>, 'getPropOptions' | 'navProps' | 'propIndexByName'> & Pick<ReturnType<typeof usePageEditorState>, 'idToTitle' | 'allNotes' | 'metadata' | 'propClipboardRef' | 't' | 'isEditor' | 'activeProp' | 'setActiveProp' | 'isPropertiesOpen' | 'propertiesPanelRef' | 'titleInputRef' | 'editorApiRef' | 'didAutofocusTitleRef' | 'setIsPropertiesOpen' | 'linksHeaderRef' | 'propertiesHeaderRef' | 'setIsLinksInfoOpen'> & Pick<ReturnType<typeof usePageMetadata>, 'handleMetaChange'>;
export function usePropertyNavigation(state: Input) {
  const { getPropOptions, idToTitle, allNotes, metadata, navProps, propClipboardRef, t, isEditor, handleMetaChange, activeProp, propIndexByName, setActiveProp, isPropertiesOpen, propertiesPanelRef, titleInputRef, editorApiRef, didAutofocusTitleRef, setIsPropertiesOpen, linksHeaderRef, propertiesHeaderRef, setIsLinksInfoOpen } = state;


  // Coercion context (options) for a select/multi/relation property.
    const propCoercionCtx = useCallback((entry: PropertyEntry): PageCoercionContext => {
    const { type, prop } = entry;
    if (type === 'select' || type === 'status' || type === 'multi_select') {
            return { options: getPropOptions(prop), idToTitle };
    }
    if (type === 'relation') {
      const relatedTableId = prop?.relation_database_id;
      const relatedNotes = allNotes.filter(n => {
        const nTableId = n.resolved_table_id || n.metadata?.table_id || n.metadata?.database_table_id;
        return nTableId === relatedTableId;
      });
      return { relatedNotes, idToTitle };
    }
    return {};
  }, [getPropOptions, idToTitle, allNotes]);


  const copyPropValue = useCallback((name: string) => {
    const entry = navProps.find(p => p.name === name);
    if (!entry) return;
    const value = metadata[name];
    propClipboardRef.current = { value, type: entry.type };
    const text = serializeCellForClipboard(value, entry.type, idToTitle);
    void writeClipboardText(text).catch(() => { });
    toast.success(t('editor.property_copied', { name, defaultValue: `Copiat: ${name}` }));
  }, [navProps, metadata, propClipboardRef, idToTitle, t]);


  const pastePropValue = useCallback(async (name: string) => {
    if (!isEditor) return;
    const entry = navProps.find(p => p.name === name);
    if (!entry) return;
    let raw;
    if (propClipboardRef.current != null) {
      raw = propClipboardRef.current.value;
    } else {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch { /* Keep the empty fallback. */ }
      const m = parseClipboardMatrix(text);
      raw = m[0]?.[0];
      if (raw === undefined) return;
    }
        const res = coercePageProperty(raw, entry.type, propCoercionCtx(entry));
    if (res.skip) { toast(t('editor.paste_incompatible', { defaultValue: "Value incompatible with the property type" })); return; }
    handleMetaChange(name, res.value);
  }, [handleMetaChange, isEditor, navProps, propClipboardRef, propCoercionCtx, t]);


  const movePropCursor = useCallback((delta: number) => {
    if (navProps.length === 0) return;
    const cur = activeProp != null && propIndexByName.has(activeProp) ? (propIndexByName.get(activeProp) ?? -1) : -1;
    let next = cur + delta;
    if (next < 0) next = 0;
    if (next > navProps.length - 1) next = navProps.length - 1;
    setActiveProp(navProps[next]?.name ?? null);
  }, [navProps, activeProp, propIndexByName, setActiveProp]);


  // Keep keyboard cursor state, DOM focus, and the nested page scroll in
  // sync. Updating activeProp alone can move the highlight beyond the
  // viewport while focus remains on the previous row.
  useEffect(() => {
    if (!activeProp || !isPropertiesOpen) return undefined;
    const frame = requestAnimationFrame(() => {
      focusPropertyRow(propertiesPanelRef.current || document, activeProp);
    });
    return () => { cancelAnimationFrame(frame); };
  }, [activeProp, isPropertiesOpen, propertiesPanelRef]);


  // ── Focus navigation between zones (title ↔ properties ↔ body) ─────────
  const focusTitle = useCallback(() => {
    const el = titleInputRef.current;
    if (!el) return;
    el.focus();
    try { const len = el.value.length; el.setSelectionRange(len, len); } catch { /* noop */ }
  }, [titleInputRef]);


  const focusBody = useCallback(() => {
    setActiveProp(null);
    editorApiRef.current?.focusFirstBlock?.();
  }, [editorApiRef, setActiveProp]);

  useEffect(() => {
    if (didAutofocusTitleRef.current) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = titleInputRef.current;
      if (!el || el.offsetParent === null) return;
      const ae = document.activeElement;
      const tag = (ae?.tagName || '').toLowerCase();
      const typingElsewhere = (tag === 'input' || tag === 'textarea' || (ae instanceof HTMLElement && ae.isContentEditable)) && ae !== el;
      if (typingElsewhere) return;
      didAutofocusTitleRef.current = true;
      focusTitle();
    });
    return () => { cancelAnimationFrame(raf); };
  }, [didAutofocusTitleRef, focusTitle, titleInputRef]);


  // Selects a property AND moves DOM focus to it (necessary because
  // the panel's keyboard listener only acts if the active element is not
  // a text field: if focus stays on the contenteditable body, the ↑↓ keys
  // wouldn't navigate). It's done on the next frame because the row already exists.
  const selectAndFocusProp = useCallback((name: string) => {
    if (!name) return;
    setIsPropertiesOpen(true);
    setActiveProp(name);
    const tryFocus = () => {
      const root = propertiesPanelRef.current || document;
      return focusPropertyRow(root, name);
    };
    // If the panel is already open, the row exists in the DOM and we focus it right away.
    // If we had to open it (setIsPropertiesOpen), it hasn't
    // rendered yet: we retry it after React's commit.
    if (!tryFocus()) {
      requestAnimationFrame(tryFocus);
      setTimeout(tryFocus, 0);
    }
  }, [propertiesPanelRef, setActiveProp, setIsPropertiesOpen]);


  // Plain ↑ on the first line of the body: if there are properties/links → jumps to the panel above.
  const navigateUpFromBody = useCallback(() => {
    if (linksHeaderRef.current) {
      linksHeaderRef.current.focus();
    } else if (propertiesHeaderRef.current) {
      propertiesHeaderRef.current.focus();
    } else {
      focusTitle();
    }
  }, [focusTitle, linksHeaderRef, propertiesHeaderRef]);


  const handlePropertiesHeaderKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusTitle();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (linksHeaderRef.current) {
        linksHeaderRef.current.focus();
      } else {
        focusBody();
      }
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setIsPropertiesOpen(true);
      if (navProps.length > 0) {
        selectAndFocusProp(navProps[0]?.name ?? "");
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsPropertiesOpen(false);
    }
  }, [focusTitle, linksHeaderRef, focusBody, setIsPropertiesOpen, navProps, selectAndFocusProp]);


  const handleLinksHeaderKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (propertiesHeaderRef.current) {
        propertiesHeaderRef.current.focus();
      } else {
        focusTitle();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusBody();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setIsLinksInfoOpen((prev) => !prev);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsLinksInfoOpen(false);
    }
  }, [propertiesHeaderRef, focusTitle, focusBody, setIsLinksInfoOpen]);


  // ⌥↑ (dedicated shortcut): opens the panel and jumps to the first property.
  // If the page has no properties, it falls back to the title.
  const openPropertiesNav = useCallback(() => {
    if (navProps.length > 0) {
      selectAndFocusProp(navProps[0]?.name ?? "");
    } else {
      focusTitle();
    }
  }, [navProps, selectAndFocusProp, focusTitle]);


  // Keyboard listener for the properties panel (at window level).
  useEffect(() => {
    if (!activeProp || !isPropertiesOpen) return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = document.activeElement;
      const tag = el?.tagName;
      const inputType = el?.getAttribute('type') || '';
      const isTextInput = (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(inputType)) || tag === 'TEXTAREA' || (el instanceof HTMLElement && el.isContentEditable);
      if (isTextInput) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copyPropValue(activeProp); return; }
      if (meta && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); void pastePropValue(activeProp); return; }
      if (meta) return;
      // ⌥↑ / ⌥↓: jump zone (up = title, down = body), like
      // the editor and the title — consistent with the global zone shortcut.
      if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); setActiveProp(null); focusTitle(); return; }
      if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); focusBody(); return; }
      if (e.altKey) return;
      const cur = propIndexByName.has(activeProp) ? (propIndexByName.get(activeProp) ?? -1) : -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (cur < navProps.length - 1) movePropCursor(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (cur > 0) movePropCursor(-1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setActiveProp(null);
        setIsPropertiesOpen(false);
        if (propertiesHeaderRef.current) propertiesHeaderRef.current.focus();
      }
    };
    return subscribeWindowEvent('keydown', onKey);
  }, [activeProp, isPropertiesOpen, setIsPropertiesOpen, copyPropValue, pastePropValue, movePropCursor, propIndexByName, navProps, focusTitle, focusBody, setActiveProp, propertiesHeaderRef]);
  return { propCoercionCtx, copyPropValue, pastePropValue, movePropCursor, focusTitle, focusBody, selectAndFocusProp, navigateUpFromBody, handlePropertiesHeaderKeyDown, handleLinksHeaderKeyDown, openPropertiesNav };
}
