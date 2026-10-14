import { emitAppEvent } from '../platform/app-events';
import { defineStorageKey, jsonStorageCodec, readStorage, writeStorage } from '../platform/browser-storage';

export interface CustomStyle {
    readonly id: string;
    readonly name: string;
    readonly css: string;
    readonly enabled: boolean;
}
export interface CustomAppearance {
    readonly activeTheme: string;
    readonly themes: readonly CustomStyle[];
    readonly snippets: readonly CustomStyle[];
}
export const EMPTY_APPEARANCE: CustomAppearance = { activeTheme: '', themes: [], snippets: [] };
const MAX_CSS_LENGTH = 50_000;
const STYLE_ID = 'gnosi-custom-appearance';

/** CSS escapes/comments must not disguise imports or network-bearing functions. */
export function validateCustomCss(css: string): 'external' | 'too_long' | null {
    if (css.length > MAX_CSS_LENGTH) return 'too_long';
    const decoded = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\(?:\r\n|[\n\r\f])/g, '')
        .replace(/\\([\da-f]{1,6})\s?|\\([^\r\n\f])/gi, (_match, hex: string | undefined, character: string | undefined) => {
            if (!hex) return character ?? '';
            const point = Number.parseInt(hex, 16);
            return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
        });
    return /@\s*import\b|(?:url|src|image|(?:-webkit-)?image-set)\s*\(/i.test(decoded) ? 'external' : null;
}

function isCustomStyle(value: unknown): value is CustomStyle {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<CustomStyle>;
    return typeof item.id === 'string' && /^[\w-]{1,100}$/.test(item.id)
        && typeof item.name === 'string' && item.name.length <= 100
        && typeof item.css === 'string' && !validateCustomCss(item.css) && typeof item.enabled === 'boolean';
}
function isStyleList(value: unknown): value is readonly CustomStyle[] {
    return Array.isArray(value) && value.length <= 20 && value.every(isCustomStyle)
        && new Set(value.map(item => item.id)).size === value.length;
}
function isAppearance(value: unknown): value is CustomAppearance {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<CustomAppearance>;
    return typeof item.activeTheme === 'string' && isStyleList(item.themes) && isStyleList(item.snippets)
        && (!item.activeTheme || item.themes.some(theme => theme.id === item.activeTheme));
}
export const customAppearanceKey = defineStorageKey('gnosi:custom-appearance:v1', jsonStorageCodec(isAppearance));
export function readCustomAppearance(): CustomAppearance { return readStorage(customAppearanceKey) ?? EMPTY_APPEARANCE; }

/** A URL escape hatch stays available even when a user's CSS hides the settings. */
export function customAppearanceSafeMode(): boolean {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('gnosi-safe-appearance') === '1';
}

export function applyCustomAppearance(preferences = readCustomAppearance()): void {
    if (typeof document === 'undefined') return;
    const styles = customAppearanceSafeMode() ? [] : [
        ...preferences.themes.filter(theme => theme.id === preferences.activeTheme),
        ...preferences.snippets.filter(snippet => snippet.enabled),
    ];
    const css = styles.filter(style => !validateCustomCss(style.css)).map(style => style.css).join('\n');
    const existing = document.getElementById(STYLE_ID);
    if (!css) { existing?.remove(); return; }
    const element = existing ?? Object.assign(document.createElement('style'), { id: STYLE_ID });
    if (element.textContent !== css) element.textContent = css;
    if (!existing) document.head.appendChild(element);
}

export function saveCustomAppearance(preferences: CustomAppearance): boolean {
    if (!isAppearance(preferences) || !writeStorage(customAppearanceKey, preferences)) return false;
    applyCustomAppearance(preferences);
    emitAppEvent('gnosi:appearance-changed');
    return true;
}

/** Keep the saved CSS available for editing while disabling its effects. */
export function resetCustomAppearance(): boolean {
    const preferences = readCustomAppearance();
    return saveCustomAppearance({ ...preferences, activeTheme: '', snippets: preferences.snippets.map(snippet => ({ ...snippet, enabled: false })) });
}
