import { useCallback } from 'react';
import { canonicalStorageFolder, getImageSrc, isImageFieldName, parseImageField, withActiveVault } from '../../../../shared/resources/fileResource';
import { toast } from '../../../../shared/notifications/toast';
import { transportFetch } from '../../../../shared/api/transports';
import { displayString, getTableFieldConfig, isRecord } from './fieldConfig';
import { getMetaKey } from './metadata';
import type { TableInputs } from './tableInputs';
import type { TableNote } from './types';
import type { useTableData } from './useTableData';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableIdentity>, 't'>
  & Pick<TableInputs, 'schema' | 'allNotes' | 'idToTitle' | 'activeView'>
  & Pick<ReturnType<typeof useTableData>, 'resolveNoteTableId'>
  & Pick<ReturnType<typeof useTableState>, 'setMediaPickerCell'>;

export function useTableMedia({
  t,
  schema,
  allNotes,
  idToTitle,
  activeView,
  resolveNoteTableId,
  setMediaPickerCell,
}: Inputs) {
  const toImagePreviewUrl = useCallback((rawValue: unknown) => {
    if (!rawValue || typeof rawValue !== 'string') return '';
    const value = rawValue.trim();
    if (!value) return '';

    const lower = value.toLowerCase();
    const hasImageExtension = /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|\.avif|\.bmp)(\?|#|$)/i.test(lower);
    const isDataImage = lower.startsWith('data:image/');
    if (!isDataImage && !hasImageExtension) return '';

    if (value.startsWith('/api/vault/assets/')) return withActiveVault(value);
    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:image/')) return value;

    if (value.startsWith('Assets/')) return withActiveVault(`/api/vault/assets/${value.slice('Assets/'.length)}`);
    if (value.startsWith('../Assets/')) return withActiveVault(`/api/vault/assets/${value.slice('../Assets/'.length)}`);
    if (value.startsWith('./Assets/')) return withActiveVault(`/api/vault/assets/${value.slice('./Assets/'.length)}`);

    const assetsIdx = value.indexOf('/Assets/');
    if (assetsIdx >= 0) return withActiveVault(`/api/vault/assets/${value.slice(assetsIdx + '/Assets/'.length)}`);

    if (!value.startsWith('/') && !value.includes('://')) {
      return withActiveVault(`/api/vault/assets/${value.replace(/^\.\//, '')}`);
    }

    return '';
  }, []);
  const isImageField = useCallback((field: string, fieldType: string) => {
    if (fieldType === 'files') return true;
    if (fieldType === 'image') return true;
    if (fieldType && fieldType !== 'text') return false;
    return isImageFieldName(field);
  }, []);
  const urlToVaultPath = useCallback((url: string) => {
    if (!url) return '';
    const prefix = '/api/vault/assets/';
    if (url.startsWith(prefix)) return (url.slice(prefix.length).split('?')[0] ?? '');
    return url;
  }, []);
  const getImagePreviewUrlFromValue = useCallback((rawValue: unknown) => {
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      return toImagePreviewUrl(getImageSrc(rawValue));
    }
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        const candidate = toImagePreviewUrl(getImageSrc(item));
        if (candidate) return candidate;
      }
      return '';
    }

    const asString = displayString(rawValue || '').trim();
    if (!asString) return '';

    const direct = toImagePreviewUrl(asString);
    if (direct) return direct;

    const parts = asString.split(',').map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const candidate = toImagePreviewUrl(part);
      if (candidate) return candidate;
    }

    return '';
  }, [toImagePreviewUrl]);
  const parseResourceValue = useCallback((rawValue: unknown) => {
    if (rawValue === undefined || rawValue === null) return null;
    const text = displayString(rawValue).trim();
    if (!text) return null;

    const markdownMatch = text.match(/\(([^)]+)\)/);
    const candidate = markdownMatch ? (markdownMatch[1] ?? '').trim() : text;

    if (candidate.startsWith('zotero://')) {
      return { zotero_uri: candidate, file_path: null, attachments: null };
    }

    if (candidate.startsWith('file://')) {
      return { zotero_uri: null, file_path: candidate, attachments: null };
    }

    const embeddedZotero = candidate.match(/zotero:\/\/\S+/i);
    if (embeddedZotero?.[0]) {
      return { zotero_uri: embeddedZotero[0], file_path: null, attachments: null };
    }

    return { zotero_uri: null, file_path: candidate, attachments: null };
  }, []);
  const handleOpenZoteroValue = useCallback(async (rawValue: unknown) => {
    const payload = parseResourceValue(rawValue);
    if (!payload || (!payload.zotero_uri && !payload.file_path)) {
      toast.error(t('table.zotero_empty_error'));
      return;
    }

    try {
      const response = await transportFetch('/api/vault/open-resource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data: unknown = await response.json().catch(() => ({}));
        throw new Error(displayString((isRecord(data) ? data.detail : undefined) || t('table.zotero_open_error')));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('table.zotero_open_error');
      toast.error(message);
    }
  }, [parseResourceValue, t]);
  const getRelationContext = (field: string) => {
    const config = getTableFieldConfig(schema, field);
    const relatedTableId = config.relation_database_id;
    const relatedNotes = relatedTableId
      ? allNotes.filter(n => {
        const nTableId = n.resolved_table_id || n.metadata?.table_id || n.metadata?.database_table_id;
        return nTableId === relatedTableId;
      })
      : [];
    const displayMap = {
      ...idToTitle,
      ...Object.fromEntries(relatedNotes.map(n => [n.id, n.title || idToTitle[n.id] || n.id])),
    };
    return { relatedTableId, relatedNotes, displayMap };
  };
  const openMediaPicker = useCallback((note: TableNote, key: string, fieldType: string) => {
    const noteTableId = activeView?.table_id || resolveNoteTableId(note);
    const metaKey = getMetaKey(note, key);
    const cfg = fieldType === 'files' ? (getTableFieldConfig(schema, key)) : null;
    const isImg = fieldType !== 'files'; // image field detected by name (not `files`)
    setMediaPickerCell({
      rowId: note.id, field: key, originalMetaKey: metaKey, tableId: noteTableId,
      fileField: cfg
        ? { propertyName: key, storageFolder: canonicalStorageFolder(cfg.storage_folder) || 'assets', namePattern: cfg.name_pattern || '', fileMode: cfg.file_mode || 'upload' }
        : null,
      imageField: isImg,
      imageMeta: isImg ? parseImageField(note.metadata?.[metaKey]) : null,
      rowMetadata: note.metadata || {},
    });
  }, [activeView?.table_id, resolveNoteTableId, schema, setMediaPickerCell]);
  return { isImageField, urlToVaultPath, getImagePreviewUrlFromValue, handleOpenZoteroValue, getRelationContext, openMediaPicker };
}
