import { describe, expect, it, vi } from 'vitest';

import {
    isGeneratedIndexNote,
    openVaultNote,
    selectRecentNotes,
} from './vaultQuickNavigation';

describe('vault quick navigation', () => {
    it('opens a page with only its ID so normal navigation updates history', () => {
        const onNoteSelect = vi.fn();

        expect(openVaultNote(onNoteSelect, { id: 'note-1', folder: 'Notes' })).toBe(true);
        expect(onNoteSelect).toHaveBeenCalledOnce();
        expect(onNoteSelect).toHaveBeenCalledWith('note-1');
    });

    it('recognizes canonical and legacy generated indexes without hiding manual indexes', () => {
        expect(isGeneratedIndexNote({
            title: 'Anything',
            metadata: {
                llm_wiki_managed: true,
                llm_wiki_role: 'general_index',
                note_type: 'index',
            },
        })).toBe(true);
        expect(isGeneratedIndexNote({
            title: 'Índex · Tags',
            metadata: { 'Tipus de nota': 'Nota índex' },
        })).toBe(true);
        expect(isGeneratedIndexNote({
            title: 'My curated map',
            metadata: { 'Note type': 'Index note' },
        })).toBe(false);
    });

    it('keeps generated indexes out of recents while ordinary notes exist', () => {
        const notes = [
            {
                id: 'generated',
                title: 'Índex general',
                last_modified: '2026-07-30T12:00:00Z',
                metadata: { 'Tipus de nota': 'Nota índex' },
            },
            { id: 'older', title: 'Older', last_modified: '2026-07-28T12:00:00Z' },
            { id: 'newer', title: 'Newer', last_modified: '2026-07-29T12:00:00Z' },
        ];

        expect(selectRecentNotes(notes).map(note => note.id)).toEqual(['newer', 'older']);
        expect(notes.map(note => note.id)).toEqual(['generated', 'older', 'newer']);
    });

    it('shows generated indexes as a fallback when they are the only pages', () => {
        const generated = {
            id: 'generated',
            title: 'Index · Topics',
            metadata: { 'Note type': 'Index note' },
        };

        expect(selectRecentNotes([generated])).toEqual([generated]);
    });
});
