import { describe, expect, it } from 'vitest';
import { commandHotkey, hotkeyConflict, hotkeyFromEvent, isReservedHotkey, normalizeHotkey } from './hotkeys';

describe('command shortcuts', () => {
    it('normalizes platform modifiers and requires a modified logical key', () => {
        expect(normalizeHotkey('Shift+Ctrl+P')).toBe('Mod+Shift+p');
        expect(normalizeHotkey('Cmd+Alt+K')).toBe('Mod+Alt+k');
        expect(normalizeHotkey('x')).toBeNull();
        expect(normalizeHotkey('Mod+Escape')).toBeNull();
        expect(hotkeyFromEvent({ key: 'P', ctrlKey: false, metaKey: true, altKey: false, shiftKey: true })).toBe('Mod+Shift+p');
    });
    it('detects conflicts against defaults and preserves editing/navigation keys', () => {
        expect(hotkeyConflict('act-search', 'Mod+Shift+p', {}, ['command-palette', 'act-search'])).toBe('command-palette');
        expect(hotkeyConflict('act-search', 'Mod+Shift+p', { 'command-palette': '' }, ['command-palette', 'act-search'])).toBeNull();
        for (const binding of ['Mod+c', 'Mod+s', 'Mod+Shift+1', 'Mod+Alt+t', 'Mod+f']) expect(isReservedHotkey(binding)).toBe(true);
        expect(isReservedHotkey('Mod+Shift+f')).toBe(false);
        expect(commandHotkey('act-search', { 'act-search': 'Mod+c' })).toBe('');
    });
});
