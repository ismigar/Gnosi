import { describe, expect, it } from 'vitest';
import { extractSectionPreview, markdownToPlainText, parseMarkdownHeading } from './markdownPreview';
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
