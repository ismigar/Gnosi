import { Calendar, CheckSquare, Link as LinkIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { LocaleFormatSettings } from '../../../shared/i18n/useLocaleSettings';
import { getImageSrc, toAssetPreviewUrl } from '../../../shared/resources/fileResource';
import { openVaultResource } from '../../../shared/api/vaults';
import { asBool } from '../../../shared/filtering/vaultFilters';
import { FileFieldValue } from '../properties/FileFieldValue';
import {
  formatDate,
  formatNumber,
  resolveFieldFormat,
} from '../../../shared/records/model/formatUtils';
import {
  autoColorFor,
  normalizeOptions,
  optionChipStyle,
} from '../../../shared/records/model/optionCatalogUtils';
import { RelationItem } from '../properties/RelationItem';
import {
  normalizeRelationValues,
  unlinkRelationFromRecord,
} from '../properties/relationItemUtils';
import { getFieldConfig } from '../../../shared/records/model/schemaUtils';
import type { VaultSchema } from '../../../shared/records/model/schemaTypes';
import {
  feedMetadataValue,
  feedNoteTitle,
  feedValueString,
} from './vaultFeedModel';
import type {
  VaultFeedNote,
  VaultFeedPill,
  VaultFeedProps,
} from './vaultFeedTypes';


type FeedColumn = readonly [string, string];


interface UseVaultFeedPillsInput {
  readonly allNotes: readonly VaultFeedNote[];
  readonly columns: readonly FeedColumn[];
  readonly idToTitle: Readonly<Record<string, string>>;
  readonly localeSettings: LocaleFormatSettings;
  readonly onNoteSelect?: VaultFeedProps['onNoteSelect'];
  readonly onUpdateNote?: VaultFeedProps['onUpdateNote'];
  readonly schema: VaultSchema;
}


function imageAlt(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const alt: unknown = Reflect.get(value, 'alt');
  return typeof alt === 'string' ? alt : fallback;
}


function periodParts(value: unknown): { end: string; start: string } {
  const text = feedValueString(value);
  const [start = '', end = ''] = text.split('/');
  return { end, start };
}


function metadataKey(note: VaultFeedNote, field: string): string {
  const normalize = (value: string): string => value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/giu, '');
  const aliases: Readonly<Record<string, string>> = {
    dateadded: 'created_time',
    datemodified: 'last_edited_time',
  };
  const normalized = normalize(field);
  const target = normalize(aliases[normalized] ?? normalized);
  return Object.keys(note.metadata ?? {}).find((key) => normalize(key) === target)
    ?? field;
}


export function useVaultFeedPills({
  allNotes,
  columns,
  idToTitle,
  localeSettings,
  onNoteSelect,
  onUpdateNote,
  schema,
}: UseVaultFeedPillsInput) {
  const { t } = useTranslation();

  const relationDisplayMap = useCallback((field: string) => {
    const relatedTableId = getFieldConfig(schema, field).relation_database_id;
    const related = relatedTableId
      ? allNotes.filter((note) => (
        note.resolved_table_id
        ?? feedMetadataValue(note, 'table_id')
        ?? feedMetadataValue(note, 'database_table_id')
      ) === relatedTableId)
      : [];
    return {
      ...idToTitle,
      ...Object.fromEntries(related.map((note) => [
        note.id,
        feedNoteTitle(note) || idToTitle[note.id] || note.id,
      ])),
    };
  }, [allNotes, idToTitle, schema]);

  const renderValue = useCallback((
    value: unknown,
    type: string,
    field: string,
    note: VaultFeedNote,
    key: string,
  ) => {
    if (value === undefined || value === null || value === '') return null;
    if (type === 'checkbox') {
      return <CheckSquare size={14} className={asBool(value) ? 'text-indigo-500' : 'text-[var(--text-tertiary)]'} />;
    }
    if (type === 'date' || type === 'datetime') {
      const format = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
      return <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--text-secondary)]"><Calendar size={14} className="text-[var(--text-tertiary)]" />{formatDate(feedValueString(value), { dateFormat: format.dateFormat, locale: format.dateLocale, type })}</span>;
    }
    if (type === 'period') {
      const format = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
      const { end, start } = periodParts(value);
      const formatPart = (part: string): string => formatDate(part, {
        dateFormat: format.dateFormat,
        locale: format.dateLocale,
        type: part.includes('T') ? 'datetime' : 'date',
      });
      return <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--text-secondary)]"><Calendar size={14} className="text-[var(--text-tertiary)]" />{end ? `${formatPart(start)} → ${formatPart(end)}` : formatPart(start)}</span>;
    }
    if (type === 'number') {
      const format = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
      return <span className="tabular-nums text-sm text-[var(--text-secondary)]">{formatNumber(value, { currencyCode: format.currencyCode, decimals: format.decimals, kind: format.kind, locale: format.numberLocale })}</span>;
    }
    if (type === 'status' || type === 'select') {
      const text = feedValueString(value).trim();
      const option = normalizeOptions(getFieldConfig(schema, field).options)
        .find((candidate) => candidate.name === text);
      return <span className="rounded border px-2 py-0.5 text-xs font-semibold" style={optionChipStyle(option?.color || autoColorFor(text)) ?? undefined}>{text}</span>;
    }
    if (type === 'multi_select') {
      const items = Array.isArray(value)
        ? value.map(feedValueString).filter(Boolean)
        : feedValueString(value).split(',').map((item) => item.trim()).filter(Boolean);
      const options = normalizeOptions(getFieldConfig(schema, field).options);
      return <span className="inline-flex flex-wrap gap-1.5">{items.map((item) => {
        const option = options.find((candidate) => candidate.name === item);
        return <span key={item} className="rounded border px-2 py-0.5 text-xs font-medium" style={optionChipStyle(option?.color || autoColorFor(item)) ?? undefined}>{item}</span>;
      })}</span>;
    }
    if (type === 'relation') {
      const relationInput = Array.isArray(value)
        ? value.map(feedValueString)
        : feedValueString(value);
      const items = normalizeRelationValues(relationInput);
      const displayMap = relationDisplayMap(field);
      return <span className="inline-flex flex-wrap gap-1.5">{items.map((relationId) => (
        <RelationItem
          key={relationId}
          relationId={relationId}
          title={displayMap[relationId] || relationId}
          onOpen={onNoteSelect}
          onRemove={onUpdateNote ? async () => {
            await unlinkRelationFromRecord({
              field,
              metadataKey: key,
              onUpdate: onUpdateNote,
              pageId: note.id,
              relationId,
              relationTitle: displayMap[relationId] || relationId,
              value: relationInput,
            });
          } : undefined}
        />
      ))}</span>;
    }
    if (type === 'url') {
      const url = feedValueString(value);
      return <a href={url} target="_blank" rel="noreferrer" onClick={(event) => { event.stopPropagation(); }} className="flex max-w-sm items-center gap-1 truncate text-sm text-indigo-500 hover:text-indigo-600 hover:underline"><LinkIcon size={14} /> URL</a>;
    }
    if (type === 'files') return <FileFieldValue value={value} field={field} variant="feed" />;
    if (type === 'zotero') {
      const target = feedValueString(value).trim();
      return <button type="button" onClick={(event) => {
        event.stopPropagation();
        void openVaultResource({
          file_path: target.startsWith('zotero://') ? null : target,
          zotero_uri: target.startsWith('zotero://') ? target : null,
        });
      }} className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/20" title={target}><LinkIcon size={14} /> {t('table.open_zotero', 'Open Zotero')}</button>;
    }
    if (type === 'image' || (typeof value === 'object' && !Array.isArray(value))) {
      const source = getImageSrc(value);
      const preview = toAssetPreviewUrl(source);
      if (preview) return <img src={preview} alt={imageAlt(value, field)} className="h-10 w-10 rounded object-cover" />;
      return source ? <span className="inline-block max-w-xs truncate text-sm text-[var(--text-secondary)]" title={source}>{source}</span> : null;
    }
    const text = Array.isArray(value)
      ? value.map(feedValueString).filter(Boolean).join(', ')
      : feedValueString(value);
    return <span className="text-sm text-[var(--text-primary)]">{text}</span>;
  }, [localeSettings, onNoteSelect, onUpdateNote, relationDisplayMap, schema, t]);

  return useCallback((note: VaultFeedNote): VaultFeedPill[] => {
    const pills: VaultFeedPill[] = [];
    for (const [field, type] of columns) {
      const key = metadataKey(note, field);
      const node = renderValue(feedMetadataValue(note, key), type, field, note, key);
      if (node) pills.push({ key: field, node });
    }
    return pills;
  }, [columns, renderValue]);
}
