import { beforeAll, describe, expect, it } from 'vitest';
import { wikiSuggestions } from './wikiSuggestions';
import { transclusionSuggestions } from './transclusionSuggestions';
import { menuItem, translationsReady, viewInputs } from './test-support';

beforeAll(async () => { await translationsReady; });

describe('editor wiki suggestions', () => {
    it('keeps duplicate-title disambiguation, aliases and the complete raw query in callbacks', async () => {
        const inputs = viewInputs();
        const props = { ...inputs, normalizedLinkableNotes: [
            { id: 'one', title: 'Història', aliases: ['Passat'] }, { id: 'two', title: 'Història', aliases: [] },
        ] };
        const items = await wikiSuggestions('Història', props);
        menuItem(items, 'Història (one)').onItemClick();
        expect(inputs.insertWikiLink).toHaveBeenCalledWith('Història', '', 'one', 'Història');
        const aliasItems = await wikiSuggestions('Passat#Capítol', props);
        menuItem(aliasItems, 'Passat').onItemClick();
        expect(inputs.insertWikiLink).toHaveBeenLastCalledWith('Passat', 'Capítol', '', 'Passat#Capítol');
    });

    it('creates missing pages in wiki or a chosen table, excluding the wiki pseudo-table', async () => {
        const inputs = viewInputs();
        const items = await wikiSuggestions('Nou#Capítol', { ...inputs,
            allTables: [{ id: ' WIKI ', name: 'Wiki' }, { id: 'books', name: 'Llibres' }],
        });
        expect(items).toHaveLength(2);
        await menuItem(items, 'editor.create_at_wiki').onItemClick();
        expect(inputs.createMissingPageAndInsertLink).toHaveBeenLastCalledWith({ rawTitle: 'Nou', tableId: null, mode: 'wiki', section: 'Capítol' });
        await menuItem(items, 'editor.create_in_table').onItemClick();
        expect(inputs.createMissingPageAndInsertLink).toHaveBeenLastCalledWith({ rawTitle: 'Nou', tableId: 'books', mode: 'wiki', section: 'Capítol' });
    });

    it('suppresses creation for an exact case-insensitive id/title, but retains alias search behavior', async () => {
        const inputs = viewInputs();
        const props = { ...inputs, normalizedLinkableNotes: [{ id: 'note-id', title: 'Mercè', aliases: ['Alias'] }] };
        expect((await wikiSuggestions('NOTE-ID', props)).map(item => item.title)).toEqual(['Mercè']);
        expect((await wikiSuggestions('mercè', props)).map(item => item.title)).toEqual(['Mercè']);
        expect((await wikiSuggestions('Alias', props)).map(item => item.title)).toEqual(['Mercè', 'Alias', 'editor.create_at_wiki']);
    });

    it('offers headings and block references filtered by path while retaining title-based wiki payloads', async () => {
        const inputs = viewInputs();
        inputs.getNoteHeadings.mockResolvedValue([
            { title: 'Capítol', level: 2, path: 'Part I' },
            { title: '^block-a', kind: 'block', path: 'Part I', preview: 'Text' },
        ]);
        const items = await wikiSuggestions('Història#Part', { ...inputs, normalizedLinkableNotes: [{ id: 'one', title: 'Història' }] });
        expect(items.map(item => item.title)).toEqual(['H2 · Història # Part I > Capítol', 'B · Història # Part I > ^block-a']);
        expect(items[1]?.subtext).toBe('[[Història#^block-a]]');
        items[1]?.onItemClick();
        expect(inputs.insertWikiLink).toHaveBeenCalledWith('Història', '^block-a', 'one', 'Història#Part');
    });

    it('limits heading requests to five notes, headings to eight per note, and result display to twenty', async () => {
        const inputs = viewInputs();
        inputs.getNoteHeadings.mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({ title: `H${String(index)}` })));
        const items = await wikiSuggestions('#', { ...inputs,
            normalizedLinkableNotes: Array.from({ length: 30 }, (_, index) => ({ id: String(index), title: `Note ${String(index)}` })),
        });
        expect(inputs.getNoteHeadings).toHaveBeenCalledTimes(5);
        expect(items).toHaveLength(20);
        expect(items.some(item => item.title.includes('H11'))).toBe(false);
    });
});

describe('editor transclusion suggestions', () => {
    it('strips opening brackets and retains id-based embeds and explicit sections', async () => {
        const inputs = viewInputs();
        const items = await transclusionSuggestions('[[Mercè#Capítol', { ...inputs,
            normalizedLinkableNotes: [{ id: 'note-id', title: 'Mercè' }],
        });
        expect(items[0]?.subtext).toBe('![[note-id#Capítol]]');
        items[0]?.onItemClick();
        expect(inputs.insertTransclusion).toHaveBeenCalledWith('note-id', 'Mercè', 'Capítol');
    });

    it('does not search aliases for transclusions and creates a page with transclusion mode', async () => {
        const inputs = viewInputs();
        const items = await transclusionSuggestions('Alias#Section', { ...inputs,
            normalizedLinkableNotes: [{ id: 'note-id', title: 'Mercè', aliases: ['Alias'] }],
            allTables: [{ id: 'books', name: 'Books' }],
        });
        expect(items).toHaveLength(2);
        await menuItem(items, 'editor.create_transclusion_in_table').onItemClick();
        expect(inputs.createMissingPageAndInsertLink).toHaveBeenCalledWith({ rawTitle: 'Alias', tableId: 'books', mode: 'transclusion', section: 'Section' });
    });

    it('shows referenced block preview and disambiguates same-title transclusions', async () => {
        const inputs = viewInputs();
        inputs.getNoteHeadings.mockResolvedValue([{ title: '^block', kind: 'block', preview: 'Excerpt' }]);
        const items = await transclusionSuggestions('Mercè#', { ...inputs,
            normalizedLinkableNotes: [{ id: 'one', title: 'Mercè' }, { id: 'two', title: 'Mercè' }],
        });
        expect(items[0]?.title).toBe('B · Mercè (one) # ^block');
        expect(items[0]?.subtext).toBe('![[one#^block]] · Excerpt');
        items[0]?.onItemClick();
        expect(inputs.insertTransclusion).toHaveBeenCalledWith('one', 'Mercè', '^block');
    });
});
