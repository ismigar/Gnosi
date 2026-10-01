interface SectionNote {
    id: string;
    title?: string;
    resolved_table_id?: string;
    metadata?: Readonly<Record<string, unknown>> | null;
}

/** Restrict managed sections by resource identity, never by their display title. */
export function sourceSectionOptions<T extends SectionNote>(
    notes: readonly T[], config: Readonly<Record<string, unknown>>,
    metadata?: Readonly<Record<string, unknown>> | null,
): T[] {
    const tableId = config.relation_database_id;
    const resourceId = metadata?.llm_wiki_resource_id;
    const sourceTableId = metadata?.llm_wiki_source_table_id;
    const filtered = notes.filter(note => {
        const table = note.resolved_table_id || note.metadata?.table_id || note.metadata?.database_table_id;
        if (table !== tableId) return false;
        if (config.source_sections !== true) return true;
        return Boolean(resourceId && sourceTableId)
            && note.metadata?.llm_wiki_section_stale !== true
            && note.metadata?.llm_wiki_resource_id === resourceId
            && note.metadata?.llm_wiki_source_table_id === sourceTableId;
    });
    if (config.source_sections !== true) return filtered;
    return filtered.sort((first, second) => {
        const a = first.metadata?.llm_wiki_section_order;
        const b = second.metadata?.llm_wiki_section_order;
        if (!Array.isArray(a) || !Array.isArray(b)) return 0;
        for (let index = 0; index < Math.max(a.length, b.length); index++) {
            const difference = Number(a[index] || 0) - Number(b[index] || 0);
            if (difference) return difference;
        }
        return 0;
    });
}

export function sourceSectionTitle(note: SectionNote, scoped: boolean): string {
    const path = note.metadata?.llm_wiki_section_display_path || note.metadata?.llm_wiki_section_path;
    return scoped && typeof path === 'string' ? path : note.title || note.id;
}
