import type { ComponentType, ReactNode } from 'react';
import { Calendar, CheckSquare, Link as LinkIcon } from 'lucide-react';

import type { LocaleFormatSettings } from '../../../hooks/useLocaleSettings';
import { getImageSrc, toAssetPreviewUrl } from '../../../lib/fileResource';
import { transportFetch } from '../../../shared/api/transports';
import { asBool, type FilterValue } from '../../../utils/vaultFilters';
import { AutoriaDisplay as LegacyAutoriaDisplay } from '../AutoriaField';
import { FileFieldValue } from '../FileFieldValue';
import {
    formatDate,
    formatNumber,
    resolveFieldFormat,
    type FieldFormatConfig,
} from '../formatUtils';
import { RelationItem } from '../RelationItem';
import {
    normalizeRelationValues,
    unlinkRelationFromRecord,
} from '../relationItemUtils';
import { getFieldConfig } from '../schemaUtils';
import type { GalleryNote, GallerySchema } from './vaultGalleryModel';


type RelationScalar = string | number | bigint | boolean | null | undefined;


interface GalleryFieldConfig extends FieldFormatConfig {
    readonly relation_database_id?: unknown;
}


interface VaultGalleryPropertyValueProps {
    readonly allNotes: readonly GalleryNote[];
    readonly field: string;
    readonly idToTitle: Readonly<Record<string, string>>;
    readonly localeSettings: LocaleFormatSettings;
    readonly metadataKey: string;
    readonly note: GalleryNote;
    readonly onNoteSelect: (noteId: string) => void;
    readonly onUpdateNote?: (
        pageId: string,
        patch: { readonly metadata: Record<string, string[]> },
    ) => unknown;
    readonly schema: GallerySchema;
    readonly type: string;
    readonly value: FilterValue;
}


const AutoriaDisplay = LegacyAutoriaDisplay as unknown as ComponentType<{
    readonly value: unknown;
}>;
const readFieldConfig = getFieldConfig as (
    schema: GallerySchema,
    field: string,
) => GalleryFieldConfig | undefined;


function displayText(value: FilterValue): string {
    if (typeof value === 'string') return value;
    if (
        typeof value === 'number'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
    ) return String(value);
    return '';
}


function imageAlt(value: FilterValue, fallback: string): string {
    if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && 'alt' in value
    ) {
        const alt: unknown = value.alt;
        if (typeof alt === 'string') return alt;
    }
    return fallback;
}


function relationInput(value: FilterValue): RelationScalar | readonly RelationScalar[] {
    if (Array.isArray(value)) return value.filter((item): item is RelationScalar => (
        item === null
        || item === undefined
        || typeof item === 'string'
        || typeof item === 'number'
        || typeof item === 'bigint'
        || typeof item === 'boolean'
    ));
    if (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
        || value === null
        || value === undefined
    ) return value;
    return '';
}


export function VaultGalleryPropertyValue({
    allNotes,
    field,
    idToTitle,
    localeSettings,
    metadataKey,
    note,
    onNoteSelect,
    onUpdateNote,
    schema,
    type,
    value,
}: VaultGalleryPropertyValueProps): ReactNode {
    if (value === undefined || value === null || value === '') {
        return <span className="text-[var(--text-tertiary)] opacity-40">-</span>;
    }
    if (type === 'checkbox') {
        return <CheckSquare
            className={asBool(value)
                ? 'text-[var(--gnosi-primary)]'
                : 'text-[var(--text-tertiary)]'}
            size={12}
        />;
    }
    if (type === 'date') {
        const format = resolveFieldFormat(readFieldConfig(schema, field), localeSettings);
        return <div className="flex items-center gap-1 whitespace-nowrap text-[10px] text-[var(--text-secondary)]">
            <Calendar className="text-[var(--text-tertiary)]" size={12} />
            <span>{formatDate(displayText(value), {
                dateFormat: format.dateFormat,
                locale: format.dateLocale,
                type: 'date',
            })}</span>
        </div>;
    }
    if (type === 'number') {
        const format = resolveFieldFormat(readFieldConfig(schema, field), localeSettings);
        return <span className="tabular-nums">{formatNumber(value, {
            currencyCode: format.currencyCode,
            decimals: format.decimals,
            kind: format.kind,
            locale: format.numberLocale,
        })}</span>;
    }
    if (type === 'autoria') return <AutoriaDisplay value={value} />;
    if (type === 'status' || type === 'select') {
        return <span className="inline-block max-w-full truncate rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
            {displayText(value)}
        </span>;
    }
    if (type === 'multi_select') {
        const items = normalizeRelationValues(relationInput(value));
        return <div className="flex h-4 max-w-full flex-wrap gap-1 overflow-hidden">
            {items.slice(0, 2).map((item) => <span
                key={item}
                className="block max-w-full truncate whitespace-nowrap rounded-sm bg-[var(--gnosi-primary)]/10 px-1.5 text-[10px] font-medium text-[var(--gnosi-primary)]"
                title={item}
            >
                {idToTitle[item] ?? (item.length > 20 ? `${item.slice(0, 8)}…` : item)}
            </span>)}
            {items.length > 2 ? <span className="text-[10px] text-[var(--text-tertiary)]">
                +{items.length - 2}
            </span> : null}
        </div>;
    }
    if (type === 'relation') {
        const config = readFieldConfig(schema, field);
        const relatedTableId = config?.relation_database_id;
        const normalizedValue = relationInput(value);
        const displayMap = {
            ...idToTitle,
            ...Object.fromEntries(allNotes
                .filter((candidate) => (
                    candidate.resolved_table_id === relatedTableId
                    || candidate.metadata?.table_id === relatedTableId
                    || candidate.metadata?.database_table_id === relatedTableId
                ))
                .map((candidate) => [candidate.id, candidate.title || idToTitle[candidate.id] || candidate.id])),
        };
        return <div className="flex max-w-full flex-wrap gap-1">
            {normalizeRelationValues(normalizedValue).map((relationId) => <RelationItem
                key={relationId}
                onOpen={onNoteSelect}
                onRemove={onUpdateNote ? async (removedId) => {
                    await unlinkRelationFromRecord({
                        field,
                        metadataKey,
                        onUpdate: onUpdateNote,
                        pageId: note.id,
                        relationId: removedId,
                        relationTitle: displayMap[removedId] ?? removedId,
                        value: normalizedValue,
                    });
                } : undefined}
                relationId={relationId}
                title={displayMap[relationId] ?? relationId}
            />)}
        </div>;
    }
    if (type === 'url') {
        const url = displayText(value);
        return <a
            className="flex items-center gap-1 truncate text-xs text-[var(--gnosi-primary)] hover:underline"
            href={url}
            onClick={(event) => {
                event.stopPropagation();
            }}
            rel="noreferrer"
            target="_blank"
        >
            <LinkIcon size={12} /> URL
        </a>;
    }
    if (type === 'files') return <FileFieldValue field={field} value={value} variant="gallery" />;
    if (type === 'zotero') return <button
        className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500"
        onClick={(event) => {
            event.stopPropagation();
            const resource = displayText(value).trim();
            void transportFetch('/api/vault/open-resource', {
                body: JSON.stringify({
                    file_path: resource.startsWith('zotero://') ? null : resource,
                    zotero_uri: resource.startsWith('zotero://') ? resource : null,
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
        }}
        title={displayText(value)}
        type="button"
    >
        <LinkIcon size={12} /> Zotero
    </button>;
    const source = getImageSrc(value);
    const previewUrl = toAssetPreviewUrl(source);
    if ((type === 'image' || typeof value === 'object') && previewUrl) {
        return <img
            alt={imageAlt(value, field)}
            className="h-9 w-9 rounded object-cover"
            src={previewUrl}
        />;
    }
    return <span
        className="block truncate text-xs text-[var(--text-secondary)]"
        title={source || displayText(value)}
    >
        {source || displayText(value)}
    </span>;
}
