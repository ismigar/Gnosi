import type { IconName } from 'lucide-react/dynamic';

import type {
    IconPickerAnchorRect,
    LucideIconOption,
    VaultColor,
} from './types';


export const VAULT_COLORS = [
    { name: 'default', color: '#37352f', label: 'Default' },
    { name: 'gray', color: '#787774', label: 'Gray' },
    { name: 'brown', color: '#976d57', label: 'Brown' },
    { name: 'orange', color: '#d9730d', label: 'Orange' },
    { name: 'yellow', color: '#dfab01', label: 'Yellow' },
    { name: 'green', color: '#0f7b6c', label: 'Green' },
    { name: 'blue', color: '#0b6e99', label: 'Blue' },
    { name: 'purple', color: '#6940a5', label: 'Purple' },
    { name: 'pink', color: '#ad1a72', label: 'Pink' },
    { name: 'red', color: '#e03e3e', label: 'Red' },
] as const satisfies readonly VaultColor[];


const FALLBACK_ICON_NAMES = [
    'file-text', 'book-open', 'book-marked', 'notebook-pen', 'pencil',
    'pen-square', 'sticky-note', 'folder', 'folder-open', 'archive', 'tag',
    'bookmark', 'star', 'heart', 'lightbulb', 'target', 'brain',
    'graduation-cap', 'calendar', 'clock', 'alarm-clock', 'check-circle-2',
    'list-checks', 'message-square', 'mail', 'phone', 'globe', 'link-2',
    'search', 'camera', 'image', 'music', 'video', 'mic', 'map-pin', 'home',
    'building-2', 'users', 'user', 'key', 'shield', 'wrench', 'settings',
    'database', 'bar-chart-3', 'pie-chart', 'activity', 'zap', 'sparkles',
] as const satisfies readonly IconName[];


export const MAX_CUSTOM_ICONS = 30;


export interface IconPickerPosition {
    readonly left: number;
    readonly top: number;
}


export interface PickerViewport {
    readonly height: number;
    readonly width: number;
}


export function toPascalCase(name: string): string {
    return name
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}


export function normalizeCustomIcons(values: unknown): string[] {
    if (!isUnknownArray(values)) return [];

    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const clean = value.trim();
        if (!clean || seen.has(clean)) continue;
        seen.add(clean);
        normalized.push(clean);
    }
    return normalized.slice(0, MAX_CUSTOM_ICONS);
}


export function createLucideIconOptions(
    names: readonly IconName[],
): LucideIconOption[] {
    const source = names.length > 0 ? names : FALLBACK_ICON_NAMES;
    const byDisplayName = new Map<string, LucideIconOption>();
    for (const iconName of source) {
        const displayName = toPascalCase(iconName);
        if (!byDisplayName.has(displayName)) {
            byDisplayName.set(displayName, { displayName, iconName });
        }
    }
    return [...byDisplayName.values()].sort((left, right) => (
        left.displayName.localeCompare(right.displayName)
    ));
}


export function filterLucideIcons(
    icons: readonly LucideIconOption[],
    searchTerm: string,
): LucideIconOption[] {
    const query = searchTerm.toLocaleLowerCase();
    return icons.filter(({ displayName }) => (
        displayName.toLocaleLowerCase().includes(query)
    ));
}


export function selectedLucideValue(
    icon: LucideIconOption,
    color: string,
): string {
    return `lucide:${icon.displayName}:${color}`;
}


export function findVaultColor(name: string): VaultColor | undefined {
    return VAULT_COLORS.find((color) => color.name === name);
}


export function calculatePickerPosition(
    rect: IconPickerAnchorRect | null | undefined,
    viewport: PickerViewport,
): IconPickerPosition {
    if (!rect) return { left: 48, top: 0 };

    const left = Math.max(12, Math.min(rect.left, viewport.width - 362));
    const initialTop = rect.bottom + 8;
    const top = initialTop + 500 > viewport.height
        ? Math.max(12, rect.top - 508)
        : initialTop;
    return { left, top };
}


function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}
