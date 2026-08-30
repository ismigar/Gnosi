import { Database, Plus, Maximize2 } from 'lucide-react';
import type { EditorMenuItem, LinkMenuInputs } from './types';

export async function transclusionSuggestions(query: string, { t, normalizedLinkableNotes, allTables, normalizePendingLinkTitle, formatNoteDisambiguator, createMissingPageAndInsertLink, getNoteHeadings, insertTransclusion }: LinkMenuInputs): Promise<EditorMenuItem[]> {
    const normalized = (query || '');

    const rawQuery = normalized.replace(/^\[\[/, '').trim();
    const [noteQuery = '', sectionQueryRaw = ''] = rawQuery.split('#');
    const pendingTitle = normalizePendingLinkTitle(noteQuery);
    const search = noteQuery.toLowerCase();
    const sectionQuery = sectionQueryRaw.trim();
    const filteredNotes = normalizedLinkableNotes.filter((note) => {
        if (!search) return true;
        const noteTitle = (note.title || '').toLowerCase();
        const noteId = (note.id || '').toLowerCase();
        return noteTitle.includes(search) || noteId.includes(search);
    }).slice(0, 20);

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
                title: t('editor.create_transclusion_at_wiki', { title: pendingTitle }),
                aliases: [pendingTitle, 'create', 'transclusion', 'wiki'],
                group: t('editor.create_page'),
                icon: <Plus size={18} />,
                subtext: t('editor.create_and_insert_transclusion', { title: pendingTitle, section: sectionQuery ? `#${sectionQuery}` : '' }),
                onItemClick: () => createMissingPageAndInsertLink({
                    rawTitle: pendingTitle,
                    tableId: null,
                    mode: 'transclusion',
                    section: sectionQuery,
                }),
            },
            ...tableOptions.map((table) => ({
                title: t('editor.create_transclusion_in_table', { table: table.name, title: pendingTitle }),
                aliases: [pendingTitle, 'create', 'transclusion', table.name || table.id],
                group: t('editor.create_page'),
                icon: <Database size={18} />,
                subtext: t('editor.create_record_and_insert_transclusion', { table: table.name }),
                onItemClick: () => createMissingPageAndInsertLink({
                    rawTitle: pendingTitle,
                    tableId: table.id,
                    mode: 'transclusion',
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
                const hierarchy = headingPath ? `${headingPath} > ${headingTitle}` : headingTitle;
                const displayTitle = (titleCount.get(note.title) ?? 0) > 1
                    ? `${note.title} (${formatNoteDisambiguator(note.id)}) # ${hierarchy}`
                    : `${note.title} # ${hierarchy}`;

                headingItems.push({
                    title: `${isBlockRef ? 'B' : `H${String(level)}`} · ${displayTitle}`,
                    aliases: [note.id, note.title, headingTitle, hierarchy, blockPreview, 'transclusion', 'section', 'block'],
                    group: t('editor.transclusions_group'),
                    icon: <Maximize2 size={18} />,
                    subtext: isBlockRef
                        ? `![[${note.id}#${headingTitle}]] · ${blockPreview || t('editor.block_referenced')}`
                        : `![[${note.id}#${headingTitle}]]`,
                    onItemClick: () => { insertTransclusion(note.id, note.title, headingTitle); },
                });
            }
        }

        if (headingItems.length > 0) {
            return [...headingItems.slice(0, 20), ...createItems].slice(0, 30);
        }
    }

    const transclusionItems = filteredNotes.map((note) => ({
        title: (titleCount.get(note.title) ?? 0) > 1 ? `${note.title} (${formatNoteDisambiguator(note.id)})` : note.title,
        aliases: [note.id, 'transclusion', 'embed', '![['],
        group: t('editor.transclusions_group'),
        icon: <Maximize2 size={18} />,
        subtext: sectionQuery ? `![[${note.id}#${sectionQuery}]]` : `![[${note.id}]]`,
        onItemClick: () => { insertTransclusion(note.id, note.title, sectionQuery); },
    }));

    return [...transclusionItems, ...createItems].slice(0, 30);
}
