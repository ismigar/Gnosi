import { Calendar, CheckSquare, Clock, Link as LinkIcon, Unlock } from 'lucide-react';
import { filenameFromTarget } from '../../../../shared/resources/fileResource';
import { asBool } from '../../../../shared/filtering/vaultFilters';
import { AutoriaDisplay } from '../../properties/AutoriaField';
import { FileFieldValue } from '../../properties/FileFieldValue';
import { formatDate, formatNumber, resolveFieldFormat } from '../../../../shared/records/model/formatUtils';
import { ImageHoverPreview } from '../../../../shared/ui/previews/ImageHoverPreview';
import { optionChipStyle } from '../../../../shared/records/model/optionCatalogUtils';
import { RelationItem } from '../../properties/RelationItem';
import { parsePeriod, periodDaysInclusive } from '../../properties/VaultDateProperty';
import { displayString, getTableFieldConfig } from './fieldConfig';
import { normalizeRelationValues as normalizeTableRelations } from '../../properties/relationItemUtils';
import { cellNode, metadataDate, tableText } from './cellValues';
import type { TableController } from './useTableController';

export function CellValue({ model, value, type, noteId, field, originalMetaKey }: { model: TableController, value: unknown; type: string; noteId: string; field: string; originalMetaKey: string; }) {
  const {
    schema,
    t,
    i18n,
    idToTitle,
    getOptionColorMap,
    getRelationContext,
    onNoteSelect,
    handleRelationUnlink,
    localeSettings,
    getImagePreviewUrlFromValue,
    handleOpenZoteroValue,
    setFileDeletePrompt,
  } = model;
  const isManual = model.noteById.get(noteId)?.metadata?.[`${originalMetaKey}_manual`];
  const isImageLikeField = model.isImageField(field, type);
  switch (type) {
    case 'checkbox':
      return asBool(typeof value === 'object' ? displayString(value) : value) ? <CheckSquare size={16} className="text-indigo-500" /> : <div className="w-4 h-4 border border-[var(--border-primary)] rounded-sm"></div>;
    case 'number': {
      const fmt = resolveFieldFormat(getTableFieldConfig(schema, field), localeSettings);
      return (
        <span className="tabular-nums" title={displayString(value)}>
          {formatNumber(value, { kind: fmt.kind, decimals: fmt.decimals, currencyCode: fmt.currencyCode, locale: fmt.numberLocale })}
        </span>
      );
    }
    case 'virtual': {
      if (typeof value === 'boolean' || value === 'true' || value === 'false') {
        return (value && value !== 'false')
          ? <CheckSquare size={16} className="text-indigo-500" />
          : <div className="w-4 h-4 border border-[var(--border-primary)] rounded-sm"></div>;
      }
      const vfmt = resolveFieldFormat(getTableFieldConfig(schema, field), localeSettings);
      return (
        <span className="tabular-nums" title={displayString(value)}>
          {formatNumber(value, { kind: vfmt.kind, decimals: vfmt.decimals, currencyCode: vfmt.currencyCode, locale: vfmt.numberLocale })}
        </span>
      );
    }
    case 'date':
    case 'datetime': {
      const importedRange = value && typeof value === 'object'
        ? parsePeriod(value)
        : null;
      const displayValue = importedRange?.start || value;
      const parsed = metadataDate(displayValue);
      if (isNaN(parsed.getTime())) {
        const rawLabel = typeof value === 'object'
          ? JSON.stringify(value)
          : displayString(value);
        return <span className="truncate max-w-[200px] block text-[var(--text-tertiary)]" title={rawLabel}>{rawLabel}</span>;
      }
      const fmt = resolveFieldFormat(getTableFieldConfig(schema, field), localeSettings);
      const formatBoundary = (boundary: unknown) => formatDate(metadataDate(boundary), {
        dateFormat: fmt.dateFormat,
        type: displayString(boundary).includes('T') ? 'datetime' : type,
        locale: fmt.dateLocale,
      });
      return (
        <div className="flex items-center gap-1.5 whitespace-nowrap text-[var(--text-primary)]">
          {type === 'datetime' ? <Clock size={14} className="text-[var(--text-tertiary)]" /> : <Calendar size={14} className="text-[var(--text-tertiary)]" />}
          <span>{formatBoundary(displayValue)}</span>
          {importedRange?.end && importedRange.end !== importedRange.start && (
            <>
              <span className="text-[var(--text-tertiary)]">→</span>
              <span>{formatBoundary(importedRange.end)}</span>
            </>
          )}
        </div>
      );
    }
    case 'period': {
      const { start, end, durationDays, predecessorIds } = parsePeriod(value);
      const fmt = resolveFieldFormat(getTableFieldConfig(schema, field), localeSettings);
      const fmtPeriodDate = (d: string) => {
        if (!d) return '?';
        const hasTime = displayString(d).includes('T');
        if (fmt.dateFormat && fmt.dateFormat !== 'locale') {
          return formatDate(d, {
            dateFormat: fmt.dateFormat,
            type: hasTime ? 'datetime' : 'date',
            locale: fmt.dateLocale,
          });
        }
        return new Date(d).toLocaleString(
          fmt.dateLocale || i18n.language,
          hasTime
            ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
            : { day: '2-digit', month: 'short' },
        );
      };
      const days = durationDays ?? periodDaysInclusive(start, end);
      return (
        <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded border border-[var(--border-primary)] w-fit">
          <span>{fmtPeriodDate(start)}</span>
          <span className="text-[var(--text-tertiary)]">→</span>
          <span>{fmtPeriodDate(end)}</span>
          {days != null && (
            <span className="text-[var(--text-tertiary)] ml-0.5" title={t('table.period_days', { count: days, defaultValue: "{{count}} days" })}>· {days} d</span>
          )}
          {predecessorIds.length > 0 && (
            <span
              className="text-[var(--text-tertiary)] ml-0.5"
              title={predecessorIds.map((id) => idToTitle[id] || id).join(', ')}
            >
              · {t('vault_date.period_predecessor_count', {
                count: predecessorIds.length,
                defaultValue: "{{count}} predecessors",
              })}
            </span>
          )}
        </div>
      );
    }
    case 'status':
    case 'select': {
      const chipStyle = optionChipStyle(getOptionColorMap(field)[displayString(value)]);
      return (
        <div className="flex items-center gap-1.5">
          <span
            className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${chipStyle ? '' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-primary)]'}`}
            style={chipStyle || undefined}
          >
            {cellNode(value)}
          </span>
          {Boolean(isManual) && <Unlock size={10} className="text-amber-500 opacity-60" {...{ title: t('table.manual_value') }} />}
        </div>
      );
    }
    case 'multi_select': {
      const items = normalizeTableRelations(value);
      const colorMap = getOptionColorMap(field);
      return (
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar pr-1 py-0.5">
          {items.map((it, idx) => {
            const chipStyle = optionChipStyle(colorMap[it]);
            return (
              <span
                key={idx}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap border ${chipStyle ? '' : 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] border-[var(--gnosi-primary)]/20'}`}
                style={chipStyle || undefined}
                title={it}
              >
                {idToTitle[it] || (it.length > 20 ? it.substring(0, 8) + '...' : it)}
              </span>
            );
          })}
        </div>
      );
    }
    case 'relation': {
      const items = normalizeTableRelations(value);
      const displayMap = getRelationContext(field).displayMap;
      return (
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar pr-1 py-0.5">
          {items.map(relationId => (
            <RelationItem
              key={relationId}
              relationId={relationId}
              title={displayMap[relationId] || relationId}
              onOpen={onNoteSelect}
              onRemove={async () => {
                await handleRelationUnlink(
                  noteId,
                  field,
                  originalMetaKey,
                  relationId,
                  displayMap,
                );
              }}
            />
          ))}
        </div>
      );
    }
    case 'autoria':
      return <AutoriaDisplay value={value} />;
    case 'url':
      {
        const imageUrl = getImagePreviewUrlFromValue(value);
        if (imageUrl) {
          return <ImageHoverPreview src={imageUrl} alt={field} href={imageUrl} />;
        }
      }
      return (
        <a href={tableText(value)} target="_blank" rel="noreferrer" onClick={(e) => { e.stopPropagation(); }} className="text-indigo-500 hover:underline flex items-center gap-1 truncate max-w-[150px]">
          <LinkIcon size={12} /> URL
        </a>
      );
    case 'zotero':
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleOpenZoteroValue(value);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20"
          title={displayString(value)}
        >
          <LinkIcon size={12} /> {t('table.open_zotero')}
        </button>
      );
    case 'files':
      return (
        <FileFieldValue
          value={value}
          field={field}
          variant="table"
          onRemove={(idx) => {
            const arr = (Array.isArray(value) ? value : (value ? [value] : []))
              .map(v => displayString(v ?? '')).filter(v => v.trim() !== '');
            const tgt = arr[idx];
            if (tgt === undefined) return;
            setFileDeletePrompt({
              rowId: noteId, field, originalMetaKey, idx, arr,
              target: tgt, fileName: filenameFromTarget(tgt),
            });
          }}
        />
      );
    case 'formula':
    case 'rollup': {
      const fmt = resolveFieldFormat(getTableFieldConfig(schema, field), localeSettings);
      const display = formatNumber(value, { kind: fmt.kind, decimals: fmt.decimals, currencyCode: fmt.currencyCode, locale: fmt.numberLocale });
      return (
        <div className="flex items-center gap-1.5 text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 font-mono text-[11px] w-fit">
          <span className="text-[10px] opacity-50">{type === 'rollup' ? 'r' : 'ƒ'}</span>
          <span>{display || '0'}</span>
        </div>
      );
    }
    default:
      if (isImageLikeField) {
        const imageUrl = getImagePreviewUrlFromValue(value);
        if (imageUrl) {
          return <ImageHoverPreview src={imageUrl} alt={field} />;
        }
        return <span className="text-[var(--text-tertiary)] italic">{t('table.add_image', { defaultValue: "+ Image" })}</span>;
      }
      return <span className="truncate max-w-[200px] block" title={typeof value === 'boolean' ? undefined : tableText(value)}>{cellNode(value)}</span>;
  }
}
