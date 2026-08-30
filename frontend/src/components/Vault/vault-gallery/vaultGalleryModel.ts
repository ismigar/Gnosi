import type { VaultViewPage } from '../../../hooks/useVaultViewData';
import { normalizeOptions, optionColorHex } from '../optionCatalogUtils';
import { getFieldConfig } from '../schemaUtils';


export type GalleryCardSize = 'large' | 'medium' | 'small';
export type GalleryPreviewMode = 'content' | 'cover' | 'none' | 'properties';
export type GalleryArrowDirection = 'down' | 'left' | 'right' | 'up';
export type GallerySchema = Readonly<Record<string, unknown>>;


export type GalleryNote = VaultViewPage;


export interface GalleryView {
    readonly [key: string]: unknown;
    readonly id?: string;
}


export interface GallerySection {
    readonly color: string | null;
    readonly id: string;
    readonly name: string;
    readonly notes: readonly GalleryNote[];
}


/** Native coercion keeps imported objects' receivers and thrown errors intact. */
export function galleryText(value: unknown): string {
    return Reflect.apply(String, undefined, [value]);
}


export function normalizeGalleryMetadataKey(value: unknown): string {
    return galleryText(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/gu, '')
        .replace(/[^a-z0-9]/giu, '');
}


export function galleryMetadataValue(
    note: GalleryNote,
    field: unknown,
): unknown {
    // Reflect.get applies the same ToPropertyKey as metadata[field], including
    // symbols and imported objects. Do not normalize or clone the metadata.
    const exact: unknown = note.metadata == null
        ? undefined
        : Reflect.apply(Reflect.get, undefined, [note.metadata, field]);
    if (exact !== undefined && exact !== null && exact !== '') return exact;
    const normalized = normalizeGalleryMetadataKey(field);
    const matchedKey = Object.keys(note.metadata ?? {}).find((key) => (
        normalizeGalleryMetadataKey(key) === normalized
    ));
    return matchedKey ? note.metadata?.[matchedKey] : undefined;
}


export function galleryGroupField(view: GalleryView): string {
    const field = view.groupBy ?? view.group_by ?? '';
    const enabled = Boolean(field);
    if (!enabled) return '';
    // Schema field names use template interpolation, which rejects symbols.
    if (typeof field === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string');
    return galleryText(field);
}


export function galleryCardSize(value: unknown): GalleryCardSize {
    return value === 'small' || value === 'large' ? value : 'medium';
}


export function galleryPreviewMode(value: unknown): GalleryPreviewMode {
    if (value == null || value === 'cover') return 'cover';
    return value === 'content' || value === 'properties' ? value : 'none';
}


export function galleryCoverFitClass(value: unknown): string {
    return value === 'cover' ? 'bg-cover' : 'bg-contain';
}


export function galleryVisibleProperties(value: unknown): readonly string[] | undefined {
    if (value == null) return undefined;
    if (typeof value === 'string') return value.length ? Array.from(value) : undefined;
    if (!Array.isArray(value)) {
        if ((typeof value !== 'object' && typeof value !== 'function')
            || !('length' in value) || !value.length) return undefined;
        throw new TypeError('Invalid gallery visible properties; expected field names.');
    }
    const fields: readonly unknown[] = value;
    if (fields.every((field): field is string => typeof field === 'string')) {
        return fields.length ? fields : undefined;
    }
    throw new TypeError('Invalid gallery visible properties; expected field names.');
}


function groupValues(note: GalleryNote, field: string): string[] {
    const raw = galleryMetadataValue(note, field);
    if (Array.isArray(raw)) return raw.flatMap((value) => {
        if (
            typeof value === 'string'
            || typeof value === 'number'
            || typeof value === 'bigint'
            || typeof value === 'boolean'
        ) return String(value).trim() ? [String(value)] : [];
        return [];
    });
    if (
        typeof raw !== 'string'
        && typeof raw !== 'number'
        && typeof raw !== 'bigint'
        && typeof raw !== 'boolean'
    ) return [];
    const value = String(raw);
    return value.trim() ? [value] : [];
}


export function buildGallerySections(
    notes: readonly GalleryNote[],
    schema: GallerySchema,
    view: GalleryView,
): GallerySection[] | null {
    const field = galleryGroupField(view);
    if (!field) return null;
    const config = getFieldConfig(schema, field);
    const options = Array.isArray(config.options)
        ? normalizeOptions(config.options)
        : [];
    const colors = Object.fromEntries(options.map(({ color, name }) => [name, color]));
    const buckets = new Map<string, GalleryNote[]>();
    options.forEach(({ name }) => buckets.set(name, []));
    const ungrouped: GalleryNote[] = [];
    notes.forEach((note) => {
        const values = groupValues(note, field);
        if (values.length === 0) {
            ungrouped.push(note);
            return;
        }
        values.forEach((value) => {
            const bucket = buckets.get(value) ?? [];
            bucket.push(note);
            buckets.set(value, bucket);
        });
    });
    const sections: GallerySection[] = [...buckets.entries()]
        .filter(([, groupedNotes]) => groupedNotes.length > 0)
        .map(([name, groupedNotes]) => ({
            color: colors[name] ? optionColorHex(colors[name]) : null,
            id: `g:${name}`,
            name,
            notes: groupedNotes,
        }));
    const sort = view.groupSort ?? view.group_sort ?? 'catalog';
    const direction = (view.groupSortDir ?? view.group_sort_dir) === 'desc' ? -1 : 1;
    if (sort === 'alpha') {
        sections.sort((left, right) => left.name.localeCompare(
            right.name,
            undefined,
            { numeric: true },
        ) * direction);
    } else if (sort === 'count') {
        sections.sort((left, right) => (
            left.notes.length - right.notes.length
            || left.name.localeCompare(right.name)
        ) * direction);
    } else if (direction === -1) sections.reverse();
    if (ungrouped.length > 0) sections.push({
        color: null,
        id: '__gnosi_ungrouped__',
        name: 'Sense grup',
        notes: ungrouped,
    });
    return sections;
}


export function galleryGridClass(size: GalleryCardSize): string {
    if (size === 'small') {
        return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8';
    }
    if (size === 'large') {
        return 'grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3';
    }
    return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5';
}


export function galleryCardHeightClass(size: GalleryCardSize): string {
    return size === 'small' ? 'h-40' : size === 'large' ? 'h-80' : 'h-64';
}


export function galleryCoverHeightClass(size: GalleryCardSize): string {
    return size === 'small' ? 'h-16' : size === 'large' ? 'h-48' : 'h-32';
}
