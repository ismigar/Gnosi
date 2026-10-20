import { describe, expect, it } from 'vitest';
import { extractSectionMarkdown, extractSectionPreview, markdownToPlainText, parseMarkdownHeading } from './markdownPreview';
import { extractOutgoingPageLinks, normalizeLinkedPageRef } from './outgoingLinks';

describe('editor markdown section previews', () => {
    it('recognizes only supported ATX headings and removes inline formatting', () => {
        expect(parseMarkdownHeading('  ### [Mercè](https://example.invalid) **notes** ###')).toEqual({ level: 3, title: 'Mercè notes' });
        expect(parseMarkdownHeading('####### too deep')).toBeNull();
        expect(parseMarkdownHeading('    # code block')).toBeNull();
        expect(parseMarkdownHeading(undefined)).toBeNull();
    });
    it('returns a selected section including nested headings, stopping at the next peer', () => {
        const markdown = '# Inici\nIntro\n## Notes\nUn\n### Detall\nDos\n## Final\nTres';
        expect(extractSectionPreview(markdown, ' NOTES ')).toBe('Un Detall Dos');
        expect(extractSectionPreview(markdown, 'absent')).toBe('');
        expect(extractSectionPreview(markdown, '')).toBe('');
    });
    it('does not interpret fenced headings or block ids as preview content', () => {
        const markdown = '```md\n# Notes\nFake ^target\n```\n# Notes\nReal **text** ^target\n# End\nNext';
        expect(extractSectionPreview(markdown, '^TARGET')).toBe('Real text');
        expect(extractSectionPreview(markdown, 'notes')).toBe('Real text ^target');
        expect(extractSectionPreview(markdown, '^missing')).toBe('');
    });
    it('removes embeds, wiki links, code, HTML and Markdown delimiters from preview text', () => {
        expect(markdownToPlainText('One ![[image]] [[Link]] ```code``` <b>two</b> **three**')).toBe('One two three');
        expect(markdownToPlainText(null)).toBe('');
    });
});

describe('rich Markdown section extraction', () => {
    it('retains the selected heading, nested structure, math, tables, images and code verbatim', () => {
        const selected = '## **Details**\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n### Nested\n$E=mc^2$\n\n![Image](Assets/photo.png)\n\n```md\n## Fake peer\n```';
        expect(extractSectionMarkdown(`# Start\n\n${selected}\n\n## Stop\nHidden`, 'DETAILS')).toBe(selected);
    });
    it('ignores headings and block ids inside variable-length and tilde fences', () => {
        const markdown = '````md\n```\n# Fake\nFake ^target\n````\n~~~md\n# Fake\nFake ^target\n~~~\n# Real\nFirst **line**\nsecond line ^target\n# End';
        expect(extractSectionMarkdown(markdown, 'fake')).toBeNull();
        expect(extractSectionMarkdown(markdown, '^TARGET')).toBe('First **line**\nsecond line');
        expect(extractSectionMarkdown(markdown, '^missing')).toBeNull();
    });
    it('keeps a full paragraph for inline markers and a complete table or code block for standalone markers', () => {
        expect(extractSectionMarkdown('Before\n\nFirst\nsecond **line** ^part\n\nAfter', '^part')).toBe('First\nsecond **line**');
        const table = '| A | B |\n| --- | --- |\n| one | two |';
        expect(extractSectionMarkdown(`${table}\n\n^table`, '^table')).toBe(table);
        const code = '```ts\nconst example = "^literal";\n```';
        expect(extractSectionMarkdown(`${code}\n\n^code`, '^code')).toBe(code);
        const list = '- First\n- **Second**';
        expect(extractSectionMarkdown(`${list}\n\n^list`, '^list')).toBe(list);
    });
    it('supports setext headings, distinguishes missing/empty targets, and leaves whole-note content intact', () => {
        expect(extractSectionMarkdown('Selected\n--------\n**Content**\n\nNext\n----\nHidden', 'Selected')).toBe('Selected\n--------\n**Content**');
        expect(extractSectionMarkdown('# Empty\n# Next', 'Empty')).toBe('# Empty');
        expect(extractSectionMarkdown('^empty', '^empty')).toBe('');
        expect(extractSectionMarkdown('# Other', 'missing')).toBeNull();
        expect(extractSectionMarkdown('**Body**\n\n![[Nested]]', '')).toBe('**Body**\n\n![[Nested]]');
    });
});

describe('editor outgoing links', () => {
    it.each([
        ['/vault/page/page-1#Heading', 'page-1'],
        ['https://example.invalid/@isme/knowledge/page/page-2', 'page-2'],
        ['/api/vault/pages/page%203', 'page 3'],
        ['/api/v1/vaults/brain/knowledge/pages/page-4', 'page-4'],
        ['Title%20with%20spaces#Section', 'Title with spaces'],
        ['bad%encoding', 'bad%encoding'],
        ['#only-fragment', ''],
    ])('normalizes %s without changing internal page identity', (raw, expected) => {
        expect(normalizeLinkedPageRef(raw)).toBe(expected);
    });
    it('resolves id/title/wiki embed/Markdown variants, deduplicates and omits self links', () => {
        const links = extractOutgoingPageLinks('[[one|Alias]] [[Mercè#Section]] ![[one]] [link](/vault/page/two) [[Self]]',
            { one: 'Mercè', two: 'Bernat', self: 'Self' }, 'self');
        expect(links).toEqual([
            { id: 'two', title: 'Bernat', resolved: true },
            { id: 'one', title: 'Mercè', resolved: true },
        ]);
    });
    it('keeps unresolved local links after resolved links and ignores external/image links', () => {
        const links = extractOutgoingPageLinks('[[Known]] [[Zeta]] [[alpha]] [[ALPHA]] [Local](Local) ![image](photo.png) [Web](https://example.invalid) [Path](/unknown)', { known: 'Known' });
        expect(links).toEqual([
            { id: 'known', title: 'Known', resolved: true },
            { id: '', title: 'alpha', resolved: false },
            { id: '', title: 'Local', resolved: false },
            { id: '', title: 'Zeta', resolved: false },
        ]);
    });
    it('preserves first-title-match resolution and handles missing text', () => {
        expect(extractOutgoingPageLinks('[[SAME]]', { first: 'Same', second: 'same' }))
            .toEqual([{ id: 'first', title: 'Same', resolved: true }]);
        expect(extractOutgoingPageLinks(undefined)).toEqual([]);
    });
});
