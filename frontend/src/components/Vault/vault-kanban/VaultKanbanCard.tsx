import type { ComponentProps, ReactNode } from 'react';
import { Calendar, CheckSquare, Clock, FileText, Link as LinkIcon } from 'lucide-react';

import type { LocaleFormatSettings } from '../../../hooks/useLocaleSettings';
import { formatDate, formatNumber, resolveFieldFormat } from '../formatUtils';
import { RelationItem } from '../RelationItem';
import { unlinkRelationFromRecord } from '../relationItemUtils';
import { getFieldConfig } from '../schemaUtils';
import type {
    KanbanCardField,
    KanbanMetadataValue,
    KanbanNote,
    KanbanSchema,
} from './vaultKanbanModel';
import { readKanbanCardValue } from './vaultKanbanModel';


interface KanbanUpdatePatch {
    readonly metadata: Record<string, string | string[]>;
}


function normalizeCardRelations(value: KanbanMetadataValue): string[] {
    if (Array.isArray(value)) return value.flatMap((item) => (
        typeof item === 'string'
        || typeof item === 'number'
        || typeof item === 'bigint'
        || typeof item === 'boolean'
            ? [String(item).trim()]
            : []
    )).filter(Boolean);
    if (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
    ) return String(value).split(',').map((item) => item.trim()).filter(Boolean);
    return [];
}


function stringifyCardValue(value: KanbanMetadataValue): string {
    if (value === undefined || value === null) return '';
    if (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
    ) return String(value);
    if (Array.isArray(value)) return value.map(stringifyCardValue).join(',');
    return Object.prototype.toString.call(value);
}


export interface VaultKanbanCardProps {
    readonly canDrag: boolean;
    readonly fields: readonly KanbanCardField[];
    readonly fromStatus: string;
    readonly idToTitle: Readonly<Record<string, string>>;
    readonly isSelected: boolean;
    readonly localeSettings: LocaleFormatSettings;
    readonly note: KanbanNote;
    readonly onDragEnd: () => void;
    readonly onNoteSelect: (noteId: string) => void;
    readonly onToggleSelect: (noteId: string, isShift?: boolean) => void;
    readonly onUpdateNote?: (pageId: string, patch: KanbanUpdatePatch) => unknown;
    readonly schema: KanbanSchema;
    readonly selectedCount: number;
    readonly titlePreviewProps: ComponentProps<'span'>;
    readonly untitledLabel: string;
}


function renderCardValue(
    value: KanbanMetadataValue,
    type: string,
    field: string,
    note: KanbanNote,
    metadataKey: string,
    props: Pick<
        VaultKanbanCardProps,
        'idToTitle' | 'localeSettings' | 'onNoteSelect' | 'onUpdateNote' | 'schema'
    >,
): ReactNode {
    const { idToTitle, localeSettings, onNoteSelect, onUpdateNote, schema } = props;
    if (type === 'checkbox') {
        return <CheckSquare
            className={value ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}
            size={13}
        />;
    }
    if (type === 'date') {
        const format = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
        return <span className="inline-flex items-center gap-1">
            <Calendar size={11} />
            {formatDate(stringifyCardValue(value), {
                dateFormat: format.dateFormat,
                locale: format.dateLocale,
                type: 'date',
            })}
        </span>;
    }
    if (type === 'number') {
        const format = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
        return <span className="tabular-nums">{formatNumber(value, {
            currencyCode: format.currencyCode,
            decimals: format.decimals,
            kind: format.kind,
            locale: format.numberLocale,
        })}</span>;
    }
    if (type === 'status' || type === 'select') {
        return <span className="rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[var(--text-secondary)]">
            {stringifyCardValue(value)}
        </span>;
    }
    if (type === 'multi_select') {
        const items = normalizeCardRelations(value);
        return <span className="inline-flex flex-wrap gap-1">
            {items.slice(0, 4).map((item) => <span
                className="rounded bg-[var(--gnosi-primary)]/10 px-1.5 py-0.5 text-[var(--gnosi-primary)]"
                key={item}
            >
                {idToTitle[item] ?? (item.length > 16 ? `${item.slice(0, 8)}…` : item)}
            </span>)}
            {items.length > 4 ? <span className="text-[var(--text-tertiary)]">
                +{String(items.length - 4)}
            </span> : null}
        </span>;
    }
    if (type === 'relation') {
        const relationValues = normalizeCardRelations(value);
        return <span className="inline-flex flex-wrap gap-1">
            {relationValues.map((relationId) => <RelationItem
                key={relationId}
                onOpen={onNoteSelect}
                onRemove={onUpdateNote ? async () => {
                    await unlinkRelationFromRecord({
                        field,
                        metadataKey,
                        onUpdate: (pageId, patch) => onUpdateNote(pageId, patch),
                        pageId: note.id,
                        relationId,
                        relationTitle: idToTitle[relationId] ?? relationId,
                        value: relationValues,
                    });
                } : undefined}
                relationId={relationId}
                title={idToTitle[relationId] ?? relationId}
            />)}
        </span>;
    }
    if (type === 'url') {
        return <span className="inline-flex items-center gap-1 text-[var(--gnosi-primary)]">
            <LinkIcon size={11} />URL
        </span>;
    }
    return <span>{stringifyCardValue(value)}</span>;
}


export function VaultKanbanCard(props: VaultKanbanCardProps) {
    const {
        canDrag,
        fields,
        fromStatus,
        isSelected,
        note,
        onDragEnd,
        onNoteSelect,
        onToggleSelect,
        selectedCount,
        titlePreviewProps,
        untitledLabel,
    } = props;
    return <div
        className={`group relative cursor-pointer rounded-xl border bg-[var(--bg-primary)] p-4 shadow-sm transition-all hover:shadow-md ${canDrag ? 'active:cursor-grabbing' : ''} ${isSelected ? 'border-[var(--gnosi-primary)] shadow-indigo-500/5 ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50'}`}
        draggable={canDrag}
        onClick={() => {
            if (selectedCount > 0) onToggleSelect(note.id, false);
            else onNoteSelect(note.id);
        }}
        onDragEnd={canDrag ? onDragEnd : undefined}
        onDragStart={canDrag ? (event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', JSON.stringify({
                from: fromStatus,
                id: note.id,
            }));
        } : undefined}
    >
        <label
            className={`absolute left-2 top-2 z-10 cursor-pointer ${isSelected || selectedCount > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            onClick={(event) => { event.stopPropagation(); }}
        >
            <input
                checked={isSelected}
                className="h-4 w-4 cursor-pointer rounded border-[var(--border-primary)] bg-[var(--bg-primary)]/90 text-[var(--gnosi-primary)] shadow-sm focus:ring-[var(--gnosi-primary)]"
                onChange={() => { onToggleSelect(note.id, false); }}
                type="checkbox"
            />
        </label>
        <h4 className="mb-2 flex items-start gap-2 text-sm font-semibold leading-snug text-[var(--text-primary)] transition-colors group-hover:text-[var(--gnosi-primary)]">
            <FileText className="mt-0.5 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--gnosi-primary)]/70" size={16} />
            <span {...titlePreviewProps}>{note.title || untitledLabel}</span>
        </h4>
        {fields.length > 0 ? <div className="mt-2 flex flex-col gap-1 text-[10px]">
            {fields.map(({ field, type }) => {
                const { metadataKey, value } = readKanbanCardValue(note, field);
                if (value === undefined || value === null || value === '') return null;
                return <div className="flex min-h-[16px] items-center gap-1.5 overflow-hidden" key={field}>
                    <span className="max-w-[45%] shrink-0 truncate font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                        {field}
                    </span>
                    <div className="min-w-0 flex-1 text-[var(--text-secondary)]">
                        {renderCardValue(value, type, field, note, metadataKey, props)}
                    </div>
                </div>;
            })}
        </div> : null}
        <div className="mt-2 flex items-center gap-1 border-t border-[var(--border-primary)]/50 pt-2 text-[10px] text-[var(--text-tertiary)]">
            <Clock size={12} />
            <span>{note.last_modified ? new Date(note.last_modified).toLocaleDateString() : ''}</span>
        </div>
    </div>;
}
