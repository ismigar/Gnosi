import { useMemo } from 'react';
import type { VaultEditorRegistry } from '../VaultEditorContext';
import type { MenuTable } from './editor-view/types';

function recordId(value: unknown): string | null {
    return value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : null;
}

export function useLinkableNotes(idToTitle: Readonly<Record<string, string>>, aliases: Readonly<Record<string, readonly string[]>>, registry: VaultEditorRegistry) {
    return useMemo(() => {
        const reserved = new Set([...registry.databases, ...registry.tables, ...registry.views].map(recordId));
        return Object.entries(idToTitle).filter(([id, title]) => id && !reserved.has(id) && title.trim())
            .map(([id, title]) => ({ id, title: title.trim(), aliases: aliases[id] ?? [] }));
    }, [aliases, idToTitle, registry]);
}
export function formatNoteDisambiguator(noteId: string): string {
    const id = noteId.trim(); if (!id) return 'no-id';
    return id.length <= 14 ? id : `${id.slice(0, 8)}...${id.slice(-4)}`;
}
export function readMenuTables(tables: readonly unknown[]): MenuTable[] {
    return tables.flatMap(table => {
        const id = recordId(table);
        if (!id || !table || typeof table !== 'object') return [];
        const name: unknown = Reflect.get(table, 'name');
        return [{ id, name: typeof name === 'string' ? name : null }];
    });
}
