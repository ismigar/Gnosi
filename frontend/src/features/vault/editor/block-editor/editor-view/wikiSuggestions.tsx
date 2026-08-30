import { Database, Plus, MessageSquare } from 'lucide-react';
import type { EditorMenuItem, LinkMenuInputs } from './types';

export async function wikiSuggestions(query: string, { t, normalizedLinkableNotes, allTables, normalizePendingLinkTitle, formatNoteDisambiguator, createMissingPageAndInsertLink, getNoteHeadings, insertWikiLink }: LinkMenuInputs): Promise<EditorMenuItem[]> {
    const rawQuery = (query || "").trim();
    const [noteQuery = '', sectionQueryRaw = ''] = rawQuery.split('#');
    const pendingTitle = normalizePendingLinkTitle(noteQuery);
    const search = pendingTitle.toLowerCase();
    const sectionQuery = sectionQueryRaw.trim();
    const filteredNotes = normalizedLinkableNotes.filter(note => {
        if (!search) return true;
        const noteTitle = (note.title || "").toLowerCase();
        const noteId = (note.id || "").toLowerCase();
        const aliasHit = (note.aliases || []).some(a => (a || "").toLowerCase().includes(search));
        return noteTitle.includes(search) || noteId.includes(search) || aliasHit;
    }).slice(0, 20);

    // Suggestions for note aliases: one entry per alias that
    // matches the search. Inserts `[[alias]]` (resolved via backend),
    // showing the alias as the link text (Obsidian style).
    const aliasItems = search
        ? normalizedLinkableNotes.flatMap(note =>
            (note.aliases || [])
                .filter(a => (a || "").toLowerCase().includes(search))
                .map(a => ({
                    title: (a),
                    aliases: [note.id, note.title, 'alias', 'àlies'],
                    group: t('editor.internal_links'),
                    icon: <MessageSquare size={18} />,
                    subtext: t('editor.alias_of', { defaultValue: "alias of" }) + ` ${note.title}`,
                    onItemClick: () => { insertWikiLink((a), sectionQuery, '', rawQuery); },
                }))
          ).slice(0, 8)
        : [];

    const titleCount = new Map<string, number>();
    filteredNotes.forEach((note) => {
        const key = note.title;
        titleCount.set(key, (titleCount.get(key) || 0) + 1);
    });

    const hasExactMatch = pendingTitle
        ? normalizedLinkableNotes.some((note) => {
            const noteTitle = (note.title || '').toLowerCase();
            const noteId = (note.id || '').toLowerCase();
            const wanted = pendingTitle.toLowerCase();
            return noteTitle === wanted || noteId === wanted;
        })
        : true;

    const tableOptions = allTables
        .filter((table) => table.id && (table.id).trim().toLowerCase() !== 'wiki');

    const createItems = (!hasExactMatch && pendingTitle)
        ? [
            {
                title: t('editor.create_at_wiki', { title: pendingTitle }),
                aliases: [pendingTitle, 'create', 'wiki', 'new page'],
                group: t('editor.create_page'),
                icon: <Plus size={18} />,
                subtext: t('editor.create_and_link', { title: pendingTitle, section: sectionQuery ? `#${sectionQuery}` : '' }),
                onItemClick: () => createMissingPageAndInsertLink({
                    rawTitle: pendingTitle,
                    tableId: null,
                    mode: 'wiki',
                    section: sectionQuery,
                }),
            },
            ...tableOptions.map((table) => ({
                title: t('editor.create_in_table', { table: table.name, title: pendingTitle }),
                aliases: [pendingTitle, 'create', 'table', table.name || table.id],
                group: t('editor.create_page'),
                icon: <Database size={18} />,
                subtext: t('editor.create_record_in', { table: table.name }),
                onItemClick: () => createMissingPageAndInsertLink({
                    rawTitle: pendingTitle,
                    tableId: table.id,
                    mode: 'wiki',
                    section: sectionQuery,
                }),
            })),
        ]
        : [];

    if (rawQuery.includes('#')) {
        const headingItems: EditorMenuItem[] = [];
        for (const note of filteredNotes.slice(0, 5)) {
            const headings = await getNoteHeadings(note.id);
            const filteredHeadings = headings.filter((h) => {
                if (!sectionQuery) return true;
                const title = (h.title || '').toLowerCase();
                const path = (h.path || '').toLowerCase();
                const query = sectionQuery.toLowerCase();
                return title.includes(query) || path.includes(query);
            });

            for (const heading of filteredHeadings.slice(0, 8)) {
                const headingTitle = (heading.title || '').trim();
                if (!headingTitle) continue;

                const headingPath = (heading.path || '').trim();
                const level = (heading.level || 1);
                const isBlockRef = (heading.kind || '') === 'block' || headingTitle.startsWith('^');
                const blockPreview = (heading.preview || '').trim();
                const hierarchy = isBlockRef
                    ? (headingPath ? `${headingPath} > ${headingTitle}` : headingTitle)
                    : (headingPath ? `${headingPath} > ${headingTitle}` : headingTitle);
                const displayTitle = (titleCount.get(note.title) ?? 0) > 1
                    ? `${note.title} (${formatNoteDisambiguator(note.id)}) # ${hierarchy}`
                    : `${note.title} # ${hierarchy}`;

                headingItems.push({
                    title: `${isBlockRef ? 'B' : `H${String(level)}`} · ${displayTitle}`,
                    aliases: [note.id, note.title, headingTitle, hierarchy, blockPreview, 'wiki', 'section', 'block'],
                    group: t('editor.internal_links'),
                    icon: <MessageSquare size={18} />,
                    subtext: isBlockRef
                        ? `[[${note.title}#${headingTitle}]]`
                        : `[[${note.title}#${headingTitle}]]`,
                    onItemClick: () => { insertWikiLink(note.title, headingTitle, note.id, rawQuery); },
                });
            }
        }

        if (headingItems.length > 0) {
            return [...headingItems.slice(0, 20), ...createItems].slice(0, 30);
        }
    }

    const noteItems = filteredNotes.map(note => ({
        title: (titleCount.get(note.title) ?? 0) > 1 ? `${note.title} (${formatNoteDisambiguator(note.id)})` : note.title,
        aliases: [note.id, "wiki", "internal", ...(note.aliases || [])],
        group: t('editor.internal_links'),
        icon: <MessageSquare size={18} />,
        subtext: note.id,
        onItemClick: () => { insertWikiLink(note.title, sectionQuery, note.id, rawQuery); },
    }));

    return [...noteItems, ...aliasItems, ...createItems].slice(0, 30);
}
