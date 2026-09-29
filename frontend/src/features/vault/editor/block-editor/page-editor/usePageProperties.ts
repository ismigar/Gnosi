import type { PageOption, PageProperty, PropertyEntry } from './types';
import { isRecord, legacyText } from './valueBoundaries';
import { INTERNAL_METADATA_KEY_SET } from './internalMetadata';
import { getPdfSourceUri } from '../media';
import { isManagedInternalMetadataKey } from '../../metadataVisibilityUtils';
import { serializeCellForClipboard } from '../../../properties/cellGridUtils';
import { sortFieldItems } from '../../../../../shared/schema/fieldOrdering';
import { useEffect, useMemo, useState } from 'react';
import { namedPropertyMetadata, pagePropertyConfig, pagePropertyValue } from './propertyModel';
import { fetchOptionCatalogs } from '../../../../../shared/api/vault-schema';
import { normalizeOptions, STATUS_CATALOG_REF } from '../../../../../shared/records/model/optionCatalogUtils';
import type { usePageEditorState } from './usePageEditorState';
import type { usePageMetadata } from './usePageMetadata';
type Input = Pick<ReturnType<typeof usePageEditorState>, 'metadata' | 'allTables' | 'allNotes' | 't' | 'referenceTableId' | 'newPropName' | 'setIsAddingProp' | 'setNewPropName' | 'idToTitle'> & Pick<ReturnType<typeof usePageMetadata>, 'handleMetaChange'>;

export function usePageProperties(state: Input) {
  const { metadata, allTables, allNotes, t, referenceTableId, newPropName, setIsAddingProp, handleMetaChange, setNewPropName, idToTitle } = state;

  const rawTableId = metadata.table_id || metadata.database_table_id || metadata.resolved_table_id;

  const currentTableId = (rawTableId || '').toLowerCase() === 'wiki' ? null : rawTableId;

  const currentTable = allTables.find(t => t.id === currentTableId);

  const catalogReferences = useMemo(() => {
    const references = new Set<string>();
    for (const prop of currentTable?.properties || []) {
      const configuredReference = prop.config?.catalog_ref;
      const reference = typeof configuredReference === 'string' ? configuredReference.trim() : '';
      if (reference) references.add(reference);
      else if (prop.type === 'status') references.add(STATUS_CATALOG_REF);
    }
    return Array.from(references).sort();
  }, [currentTable]);

  const [sharedOptionCatalogs, setSharedOptionCatalogs] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (catalogReferences.length === 0) return undefined;
    const controller = new AbortController();
    fetchOptionCatalogs(controller.signal)
      .then((response) => {
        if (controller.signal.aborted || !isRecord(response.catalogs)) return;
        setSharedOptionCatalogs(response.catalogs);
      })
      .catch(() => {
        // Local property options remain available when the shared catalog cannot be read.
      });
    return () => {
      controller.abort();
    };
  }, [catalogReferences]);

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
  const getPropOptions = (prop: PageProperty | null): PageOption[] => {
    if (!prop) return [];
    const configuredReference = prop.config?.catalog_ref;
    const reference = typeof configuredReference === 'string' && configuredReference.trim()
      ? configuredReference.trim()
      : (prop.type === 'status' ? STATUS_CATALOG_REF : '');
    if (reference && Object.prototype.hasOwnProperty.call(sharedOptionCatalogs, reference)) {
      return normalizeOptions(sharedOptionCatalogs[reference]).map(option => ({ ...option }));
    }
    // `config.options` always takes precedence when it EXISTS (i.e., is an array), even if
    // it's empty: if the last inline option is deleted, config.options remains []
    // and we must NOT show the old top-level `prop.options` again.
    // We only fall back to the top level if there's no config.options at all.
    if (prop.config && Array.isArray(prop.config.options)) return prop.config.options;
    if (Array.isArray(prop.options)) return prop.options;
    return [];
  };

  const getPropConfig = pagePropertyConfig;
  const propertyMetadata = useMemo(() => namedPropertyMetadata(metadata, currentTable?.properties || []), [metadata, currentTable]);
  const getPropValue = (prop: PageProperty) => pagePropertyValue(prop, propertyMetadata, allNotes, allTables);

  // `properties` is the filtered schema list shown above the body. Memoized
  // because the title input rerenders on every keystroke and recomputing
  // this 10-key filter for every table with 100+ properties was visible in
  // profiling.
  const properties = useMemo(() => {
    return (currentTable?.properties || []).filter(prop => {
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
    });
  }, [currentTable]);


  // `adhocProperties` is the list of metadata keys that aren't part of the
  // schema. Memoized for the same reason; also we rebuild a Set for O(1)
  // schema lookup instead of `properties.find` per key (was O(n*m)).
  const adhocProperties = useMemo(() => {
    const schemaNames = new Set((currentTable?.properties || []).flatMap(p => [p.name, pagePropertyConfig(p).id]));
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
  }, [metadata, currentTable]);


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
    const rawValue = entry.prop ? pagePropertyValue(entry.prop, propertyMetadata, allNotes, allTables) : metadata[entry.name];
    const value = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
      ? Object.values(rawValue).filter(Boolean).map(legacyText).join(', ')
      : serializeCellForClipboard(rawValue, entry.type, idToTitle);
    return {
      name: entry.name,
      value: value || t('common.empty'),
    };
  }), [allNotes, allTables, idToTitle, metadata, navProps, propertyMetadata, t]);
  return { rawTableId, currentTableId, currentTable, isReferenceRecord, getPropOptions, getPropConfig, getPropValue, propertyMetadata, properties, adhocProperties, zoteroExtras, pdfSourceUri, pdfCitationKey, navProps, propIndexByName, handleAddAdhocProperty, compactPropertyPreviewItems };
}
