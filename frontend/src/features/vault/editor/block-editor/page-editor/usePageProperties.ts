import type { PageProperty, PagePropertyConfig, PropertyEntry } from './types';
import { isRecord, legacyText } from './valueBoundaries';
import { INTERNAL_METADATA_KEY_SET } from './internalMetadata';
import { getPdfSourceUri } from '../media';
import { isManagedInternalMetadataKey } from '../../metadataVisibilityUtils';
import { serializeCellForClipboard } from '../../../properties/cellGridUtils';
import { sortFieldItems } from '../../../../../shared/schema/fieldOrdering';
import { useMemo } from 'react';
import type { usePageEditorState } from './usePageEditorState';
import type { usePageMetadata } from './usePageMetadata';
type Input = Pick<ReturnType<typeof usePageEditorState>, 'metadata' | 'allTables' | 't' | 'referenceTableId' | 'newPropName' | 'setIsAddingProp' | 'setNewPropName' | 'idToTitle'> & Pick<ReturnType<typeof usePageMetadata>, 'handleMetaChange'>;
export function usePageProperties(state: Input) {
  const { metadata, allTables, t, referenceTableId, newPropName, setIsAddingProp, handleMetaChange, setNewPropName, idToTitle } = state;

  const rawTableId = metadata.table_id || metadata.database_table_id || metadata.resolved_table_id;

  const currentTableId = (rawTableId || '').toLowerCase() === 'wiki' ? null : rawTableId;

  const currentTable = allTables.find(t => t.id === currentTableId);

  // The current record is a bibliographic source if it belongs to the
  // references table designated in Settings (`referenceTableId`). It's the same source
  // of truth that governs «Create from a source» and the rest of the gating of
  // references; this way «Fill from a source» follows the Settings designation
  // instead of a local heuristic for the «Citation Key».
  const isReferenceRecord = Boolean(
    referenceTableId && currentTableId &&
    currentTableId === referenceTableId
  );

  // The `select`/`multi_select` options can live in `prop.config.options`
  // (written by the inline PATCH) or in the top-level `prop.options` (which
  // the modal save writes). The PATCH doesn't touch the top level, but the
  // modal save replaces the whole table and deletes the nested `config`. So
  // if `config.options` exists it's the fresh value and takes priority; if not,
  // the top level. (Previously the top level was prioritized and an option
  // created inline wouldn't appear because the top level stayed stale.)
  const getPropOptions = (prop: PageProperty | null) => {
    if (!prop) return [];
    // `config.options` always takes precedence when it EXISTS (i.e., is an array), even if
    // it's empty: if the last inline option is deleted, config.options remains []
    // and we must NOT show the old top-level `prop.options` again.
    // We only fall back to the top level if there's no config.options at all.
    if (prop.config && Array.isArray(prop.config.options)) return prop.config.options;
    if (Array.isArray(prop.options)) return prop.options;
    return [];
  };

  // Period settings are stored as top-level property fields by the schema
  // modal, while inline option edits may live under `config`. Merge both
  // shapes before handing the field to the structured period editor.
  const getPropConfig = (prop: PageProperty | null): PagePropertyConfig => {
    if (!prop) return {};
    const config: PagePropertyConfig = { ...(prop.config || {}) };
    ['period_unit', 'duration_enabled', 'predecessors_enabled', 'skip_non_working_days', 'format'].forEach((key) => {
      if (prop[key] !== undefined) config[key] = prop[key];
    });
    if (prop.id && config.id === undefined) config.id = prop.id;
    return config;
  };

  // `properties` is the filtered schema list shown above the body. Memoized
  // because the title input rerenders on every keystroke and recomputing
  // this 10-key filter for every table with 100+ properties was visible in
  // profiling.
  const properties = useMemo(() => {
    return sortFieldItems((currentTable?.properties || []).filter(prop => {
      const normalizedName = (prop.name || '').toLowerCase();
      return (
        prop.type !== 'title' &&
        normalizedName !== 'títol' &&
        normalizedName !== 'title' &&
        normalizedName !== 'cover' &&
        normalizedName !== 'cover_manual' &&
        normalizedName !== 'icon' &&
        !normalizedName.startsWith('favorite') &&
        !normalizedName.startsWith('icon_') &&
        !normalizedName.startsWith('cover_')
      );
    }));
  }, [currentTable]);


  // `adhocProperties` is the list of metadata keys that aren't part of the
  // schema. Memoized for the same reason; also we rebuild a Set for O(1)
  // schema lookup instead of `properties.find` per key (was O(n*m)).
  const adhocProperties = useMemo(() => {
    const schemaNames = new Set(properties.map(p => p.name));
    return sortFieldItems(Object.keys(metadata).filter(key => {
      const normalizedKey = (key || '').toLowerCase();
      return (
        !INTERNAL_METADATA_KEY_SET.has(key) &&
        !isManagedInternalMetadataKey(key) &&
        // 'Zotero Extras' is a dict; ZoteroExtrasSection renders it
        // as its own panel outside the grid (see below). If it were
        // left here, the text input would show "[object Object]".
        key !== 'Zotero Extras' &&
        !normalizedKey.endsWith('_manual') &&
        !normalizedKey.startsWith('favorite') &&
        !normalizedKey.startsWith('icon_') &&
        !normalizedKey.startsWith('cover_') &&
        !schemaNames.has(key)
      );
    }), (name) => name);
  }, [metadata, properties]);


  // L3.4 / UI: dict with rare Zotero fields (patentNumber, conferenceName, …)
  // captured by the central mapper when a Zotero item carries info without
  // canonical column. Memoized to avoid useless re-renders of ZoteroExtrasSection.
  const zoteroExtras = useMemo(() => {
    const v = metadata['Zotero Extras'];
    if (!isRecord(v)) return null;
    return v;
  }, [metadata]);


  // PR #249 wired-up: PDF URI if the page has one (attachment_path
  // or file:// URL). If null, PdfAnnotationsToCite is not rendered.
  const pdfSourceUri = useMemo(() => getPdfSourceUri(metadata), [metadata]);

  const pdfCitationKey = useMemo(
    () => legacyText(metadata['Citation Key'] || '').trim() || null,
    [metadata],
  );


  // ── Properties cursor + copy/paste (grid style) ───────────
  // Ordered list of navigable properties (schema + adhoc). The adhoc ones
  // are always text.
  const navProps = useMemo(() => {
    const out: PropertyEntry[] = properties.map(p => ({ name: p.name, type: p.type, prop: p }));
    for (const k of adhocProperties) out.push({ name: k, type: 'text', prop: null });
    return out;
  }, [properties, adhocProperties]);

  const propIndexByName = useMemo(() => {
    const m = new Map<string, number>();
    navProps.forEach((p, i) => m.set(p.name, i));
    return m;
  }, [navProps]);


  const handleAddAdhocProperty = () => {
    if (!newPropName.trim()) { setIsAddingProp(false); return; }
    handleMetaChange(newPropName.trim(), "");
    setNewPropName("");
    setIsAddingProp(false);
  };

  const compactPropertyPreviewItems = useMemo(() => navProps.slice(0, 8).map((entry) => {
    const rawValue = metadata[entry.name];
    const value = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
      ? Object.values(rawValue).filter(Boolean).map(legacyText).join(', ')
      : serializeCellForClipboard(rawValue, entry.type, idToTitle);
    return {
      name: entry.name,
      value: value || t('common.empty'),
    };
  }), [idToTitle, metadata, navProps, t]);
  return { rawTableId, currentTableId, currentTable, isReferenceRecord, getPropOptions, getPropConfig, properties, adhocProperties, zoteroExtras, pdfSourceUri, pdfCitationKey, navProps, propIndexByName, handleAddAdhocProperty, compactPropertyPreviewItems };
}
