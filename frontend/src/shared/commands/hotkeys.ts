import { useEffect, useState } from 'react';
import { emitAppEvent, subscribeAppEvent } from '../platform/app-events';
import { subscribeWindowEvent } from '../platform/browser-events';
import { defineStorageKey, jsonStorageCodec, readStorage, writeStorage } from '../platform/browser-storage';

export const BUILTIN_COMMAND_TITLES: Readonly<Record<string, string>> = {
    'command-palette': 'command_palette.title',
    'nav-home': 'command_palette.nav_home', 'nav-vault': 'command_palette.nav_vault',
    'nav-graph': 'command_palette.nav_graph', 'nav-contacts': 'command_palette.nav_contacts',
    'nav-mail': 'command_palette.nav_mail', 'nav-calendar': 'command_palette.nav_calendar',
    'nav-reader': 'command_palette.nav_reader', 'nav-social': 'command_palette.nav_social',
    'nav-media': 'command_palette.nav_media', 'nav-scheduler': 'command_palette.nav_scheduler',
    'act-newnote': 'command_palette.new_note', 'act-search': 'command_palette.global_search',
    'act-tags': 'command_palette.tags', 'act-present': 'command_palette.presentation_mode',
    'act-import': 'command_palette.import_notes', 'act-comments': 'command_palette.page_comments',
    'act-workspaces': 'command_palette.workspaces', 'act-settings': 'command_palette.open_settings',
    'theme-light': 'command_palette.theme_light', 'theme-dark': 'command_palette.theme_dark',
    'theme-system': 'command_palette.theme_system', 'appearance-reset': 'settings.custom_appearance.reset',
};
export const COMMAND_PLUGINS: Readonly<Record<string, string>> = {
    'nav-contacts': 'contacts', 'nav-mail': 'mail', 'nav-calendar': 'calendar',
    'nav-reader': 'feeds-reader', 'nav-social': 'social-publishing', 'nav-media': 'social-publishing',
    'nav-scheduler': 'automations', 'act-tags': 'tags-page', 'act-comments': 'page-comments',
};
export type HotkeyBindings = Readonly<Record<string, string>>;
const isBindings = (value: unknown): value is HotkeyBindings => value !== null && typeof value === 'object'
    && !Array.isArray(value) && Object.entries(value).length <= 500
    && Object.entries(value).every(([id, binding]) => id.length <= 200 && typeof binding === 'string' && binding.length <= 80);
export const hotkeysKey = defineStorageKey('gnosi:hotkeys:v1', jsonStorageCodec(isBindings));
const DEFAULT_BINDINGS: HotkeyBindings = { 'command-palette': 'Mod+Shift+p' };

/** Use logical keys so the shortcut follows the user's keyboard layout. */
export function normalizeHotkey(value: string): string | null {
    if (!value.trim()) return '';
    const parts = value.toLowerCase().split('+').map(part => part.trim());
    const key = parts.pop();
    if (!key || !/^(?:[a-z0-9,./;[\]\\\-=`]|f(?:[1-9]|1[0-2]))$/.test(key)) return null;
    const modifiers = new Set(parts.map(part => ['ctrl', 'cmd', 'meta', 'control'].includes(part) ? 'mod' : part));
    if (!modifiers.has('mod') || [...modifiers].some(part => !['mod', 'alt', 'shift'].includes(part))) return null;
    return ['Mod', ...(modifiers.has('alt') ? ['Alt'] : []), ...(modifiers.has('shift') ? ['Shift'] : []), key].join('+');
}

export function hotkeyFromEvent(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'> & { readonly code?: string }): string | null {
    if (!(event.ctrlKey || event.metaKey) || (event.ctrlKey && event.metaKey)) return null;
    const modifiers = ['Mod', ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : [])];
    const logical = normalizeHotkey([...modifiers, event.key].join('+'));
    if (logical || !(event.altKey || event.shiftKey)) return logical;
    // Option on macOS produces symbols (for example Option-K → ˚). Keep such
    // modified shortcuts recordable while retaining logical keys elsewhere.
    const physical = event.code?.match(/^Key([A-Z])$/)?.[1]?.toLowerCase();
    return physical ? normalizeHotkey([...modifiers, physical].join('+')) : null;
}

/** Preserve editing, tab navigation, sidebar navigation and browser escape keys. */
export function isReservedHotkey(binding: string): boolean {
    const key = binding.split('+').at(-1);
    if (key && /^[0-9t]$/.test(key)) return true;
    return ['Mod+a', 'Mod+c', 'Mod+v', 'Mod+x', 'Mod+z', 'Mod+y', 'Mod+Shift+z',
        'Mod+s', 'Mod+f', 'Mod+d', 'Mod+l', 'Mod+r', 'Mod+Shift+r', 'Mod+w', 'Mod+q', 'Mod+,'].includes(binding);
}

export function commandHotkey(id: string, bindings: HotkeyBindings): string {
    const binding = normalizeHotkey(bindings[id] ?? DEFAULT_BINDINGS[id] ?? '');
    return binding && !isReservedHotkey(binding) ? binding : '';
}

export function hotkeyConflict(id: string, candidate: string, bindings: HotkeyBindings, commandIds: readonly string[]): string | null {
    if (!candidate) return null;
    return commandIds.find(other => other !== id && commandHotkey(other, bindings) === candidate) ?? null;
}

export function saveHotkeyBindings(bindings: HotkeyBindings): boolean {
    if (!writeStorage(hotkeysKey, bindings)) return false;
    emitAppEvent('gnosi:hotkeys-changed');
    return true;
}

export function useHotkeyBindings(): HotkeyBindings {
    const [bindings, setBindings] = useState(() => readStorage(hotkeysKey) ?? {});
    useEffect(() => {
        const update = () => { setBindings(readStorage(hotkeysKey) ?? {}); };
        const unsubscribe = subscribeAppEvent('gnosi:hotkeys-changed', update);
        const unsubscribeStorage = subscribeWindowEvent('storage', event => { if (!event.key || event.key === hotkeysKey.name) update(); });
        return () => { unsubscribe(); unsubscribeStorage(); };
    }, []);
    return bindings;
}
