import { expect, it } from 'vitest';
import { extractOutgoingPageLinks } from './outgoingLinks';

const id = '9c05e9c1-dd54-470f-bac9-ff59cbd70bd4';
it('displays resource titles for native and protected citations and deduplicates their pages', () => {
    const links = extractOutgoingPageLinks(`[p. 7](gnosi-cite:?res=${id}&page=7) [p. 8](https://gnosi-cite.local/?res=${id}&page=8)`, { [id]: 'A book' });
    expect(links).toEqual([{ id, title: 'A book', resolved: true }]);
});
it('resolves both stored relation and inline wikilink conventions to the same title', () => {
    expect(extractOutgoingPageLinks(`[[Old label|${id}]] [[${id}|Alias]]`, { [id]: 'Current title' }))
        .toEqual([{ id, title: 'Current title', resolved: true }]);
});
it('never exposes a citation URI or UUID when the title index is still empty', () => {
    const links = extractOutgoingPageLinks(`[p. 7](gnosi-cite:?res=${id}&page=7)`);
    expect(links[0]?.title).not.toContain(id);
    expect(links[0]?.title).not.toContain('gnosi-cite:');
});
