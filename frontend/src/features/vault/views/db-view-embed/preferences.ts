import { defineStorageKey, readStorage, writeStorage, stringStorageCodec } from '../../../../shared/platform/browser-storage';
import { presets, legacyText } from './decode';
import type { QuickPreset } from './types';
export const readText = (key: string): string | undefined => readStorage(defineStorageKey(key, stringStorageCodec));
export const writeText = (key: string, value: string): boolean => writeStorage(defineStorageKey(key, stringStorageCodec), value);
export const pinnedKey = (pageId: string | null, viewId: string): string => `gnosi_embed_pinned_${legacyText(pageId)}_${viewId}`;
export const selectedKey = (pageId: string | null, viewId: string): string => `gnosi_embed_view_${legacyText(pageId)}_${viewId}`;
export function readPinned(pageId: string | null, viewId: string): Set<string> {
    try { const value: unknown = JSON.parse(readText(pinnedKey(pageId, viewId)) || '[]'); return new Set(Array.isArray(value) ? value.map(legacyText) : []); }
    catch { return new Set(); }
}
export function readPresets(key: string): QuickPreset[] {
    try { return presets(JSON.parse(readText(key) || '[]')); } catch { return []; }
}
export function encodePresets(value: readonly QuickPreset[], href: string): string {
    const payload = JSON.stringify({ version: 1, presets: value });
    const bytes = encodeURIComponent(payload).replace(/%([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    const url = new URL(href);
    url.hash = `gnosi-view-presets=${btoa(bytes)}`;
    return url.toString();
}
export function importPresets(raw: string, now = Date.now()): QuickPreset[] {
    const encoded = raw.includes('gnosi-view-presets=') ? raw.split('gnosi-view-presets=')[1]?.split('#')[0] : undefined;
    const candidate = encoded === undefined ? raw : decodeURIComponent(Array.from(atob(encoded), ch => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    const parsed: unknown = JSON.parse(candidate);
    const incoming: unknown = Array.isArray(parsed) ? parsed : typeof parsed === 'object' && parsed !== null && 'presets' in parsed ? parsed.presets : undefined;
    if (!Array.isArray(incoming)) throw new Error('invalid preset payload');
    return presets(incoming).slice(-5).map((preset, index) => ({ ...preset, id: `${String(now)}-${String(index)}` }));
}
export function toggleContrast() {
    const next = document.documentElement.dataset.vaultContrast === 'high' ? 'normal' : 'high';
    document.documentElement.dataset.vaultContrast = next;
    writeText('gnosi.vault.contrast', next);
}
export function toggleTextSize() {
    const next = document.documentElement.dataset.vaultText === 'large' ? 'normal' : 'large';
    document.documentElement.dataset.vaultText = next;
    writeText('gnosi.vault.textSize', next);
}
