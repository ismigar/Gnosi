import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VaultMarkdown } from './VaultMarkdown';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

function render(markdown: string) {
    const element = document.createElement('div');
    element.innerHTML = renderToStaticMarkup(<VaultMarkdown md={markdown} allowVaultQueries
        idToTitle={{ other: 'Other', second: 'Second' }} sourcePageId="source" />);
    return element;
}

function wikiTargets(element: HTMLElement) {
    return [...element.querySelectorAll('[data-wikilink-target]')].map(node => node.getAttribute('data-wikilink-target'));
}

describe('wiki escape provenance in the real Markdown renderer', () => {
    it.each(['&#91;', '&#x5B;', '&lbrack;'])('keeps escaped references literal after a %s-produced opening', entity => {
        const element = render(`Entity ${entity}[Other]] followed by escaped literal \\[[Other]].`);
        expect(element.textContent).toBe('Entity Other followed by escaped literal [[Other]].');
        expect(wikiTargets(element)).toEqual(['Other']);
    });

    it('retains positions across repeated, reordered and different decoded targets', () => {
        const element = render(String.raw`\[[Second]] &#91;[Other]] [[Second]] \[[Other]] &#91;[Second]] \[[Second]]`);
        expect(element.textContent).toBe('[[Second]] Other Second [[Other]] Second [[Second]]');
        expect(wikiTargets(element)).toEqual(['Other', 'Second', 'Second']);
    });

    it.each([1, 2, 3, 4])('respects a run of %i backslashes independently of earlier entities', count => {
        const source = `&#91;[Other]] then ${'\\'.repeat(count)}[[Second]]`;
        const element = render(source);
        expect(wikiTargets(element)).toEqual(count % 2 ? ['Other'] : ['Other', 'Second']);
        expect(element.textContent).toBe(`Other then ${'\\'.repeat(Math.floor(count / 2))}${count % 2 ? '[[Second]]' : 'Second'}`);
    });

    it.each([1, 2, 3, 4])('respects a run of %i backslashes before a transclusion bang', count => {
        const element = render(`&#91;[Other]] then ${'\\'.repeat(count)}![[Second]]`);
        expect(wikiTargets(element)).toEqual(['Other']);
        expect(element.querySelectorAll('[data-transclusion-target]')).toHaveLength(count % 2 ? 0 : 1);
        if (count % 2) expect(element.textContent).toContain(`${'\\'.repeat(Math.floor(count / 2))}![[Second]]`);
    });

    it('distinguishes entity-produced, escaped-bang and escaped-bracket transclusions', () => {
        const element = render(String.raw`&excl;[[Other]] \![[Other]] !\[[Second]] ![[Second]]`);
        expect([...element.querySelectorAll('[data-transclusion-target]')].map(node => node.getAttribute('data-transclusion-target'))).toEqual(['Other', 'Second']);
        expect(element.textContent).toContain('![[Other]] ![[Second]]');
        expect(wikiTargets(element)).toEqual([]);
    });

    it('preserves decoded second brackets, closing delimiters and alias punctuation', () => {
        const element = render(String.raw`[\[Other]] [[Other\]] [[Other]\] [[Second|A \*literal\* alias &amp; punctuation!]]`);
        expect(wikiTargets(element)).toEqual(['Other', 'Other', 'Other', 'Second']);
        expect(element.textContent).toBe('Other Other Other A *literal* alias & punctuation!');
    });

    it('uses parser offsets through entities, Unicode and multiline block prefixes', () => {
        const element = render('> &#x1F600; &NotEqualTilde; &#91;[Other]]\n> \\[[Second]] and [[Second]]\n\n- &#91;[Other]]\n  \\[[Second]]');
        expect(wikiTargets(element)).toEqual(['Other', 'Second', 'Other']);
        expect(element.querySelector('blockquote')?.textContent).toContain('[[Second]] and Second');
        expect(element.querySelector('li')?.textContent).toContain('[[Second]]');
    });

    it('keeps provenance in GFM tables and task items with document references', () => {
        const element = render('| References |\n| --- |\n| &#91;[Other]] \\[[Second]] |\n\n- [ ] &#91;[Second]] \\[[Other]] [Read][guide]\n\n[guide]: https://example.org/guide');
        expect(element.querySelector('td')?.textContent).toBe('Other [[Second]]');
        expect(wikiTargets(element)).toEqual(['Other', 'Second']);
        expect(element.querySelector('li')?.textContent).toContain('Second [[Other]] Read');
        expect(element.querySelector('a')?.getAttribute('href')).toBe('https://example.org/guide');
        expect(element.querySelector('input')?.type).toBe('checkbox');
    });

    it('leaves code, ordinary links, reference destinations and HTML attributes opaque', () => {
        const source = '`&#91;[Other]] \\[[Second]]`\n\n[Literal [[Other]] and \\[\\[Second\\]\\]](https://example.org/guide)\n\n[Read][guide]\n\n<span title="[[Other]]">HTML</span>\n\n```md\n[[Other]] \\[[Second]]\n```\n\n[guide]: https://example.org/[[Other]]';
        const element = render(source);
        expect(wikiTargets(element)).toEqual([]);
        expect(element.querySelectorAll('[data-transclusion-target]')).toHaveLength(0);
        expect(element.querySelectorAll('a')).toHaveLength(2);
        expect(element.querySelector('code')?.textContent).toBe('&#91;[Other]] \\[[Second]]');
        expect(element.textContent).toContain('Literal [[Other]] and [[Second]]');
    });

    it.each(['https://example.org/guide', '/vault/page/other'])('keeps rich inline and full-reference labels literal for %s', destination => {
        const label = '**[[Other]]** *![[Unselected]]* ~~old~~ `[[Second]]` $x_1$';
        const element = render(`[${label}](${destination})\n\n[${label}][guide]\n\n[guide]: ${destination}`);
        const links = [...element.querySelectorAll('a')];
        expect(links).toHaveLength(2);
        expect(links.map(link => link.getAttribute('href'))).toEqual([destination, destination]);
        expect(links[0]?.innerHTML).toBe(links[1]?.innerHTML);
        expect(links[0]?.querySelector('strong')?.textContent).toBe('[[Other]]');
        expect(links[0]?.querySelector('em')?.textContent).toBe('![[Unselected]]');
        expect(links[0]?.querySelector('del')?.textContent).toBe('old');
        expect(links[0]?.querySelector('code')?.textContent).toBe('[[Second]]');
        expect(links[0]?.querySelectorAll('.katex')).toHaveLength(1);
        expect(wikiTargets(element)).toEqual([]);
        expect(element.querySelectorAll('[data-transclusion-target]')).toHaveLength(0);
    });

    it.each(['', '[]'])('keeps valid shortcut/collapsed %s reference labels literal after entity decoding', suffix => {
        const label = 'Entity &#91;&#91;Other&#93;&#93; &excl;&#91;&#91;Unselected&#93;&#93;';
        const element = render(`[${label}]${suffix}\n\n[${label}]: https://example.org/guide`);
        expect(element.querySelectorAll('a')).toHaveLength(1);
        expect(element.querySelector('a')?.textContent).toBe('Entity [[Other]] ![[Unselected]]');
        expect(wikiTargets(element)).toEqual([]);
        expect(element.querySelectorAll('[data-transclusion-target]')).toHaveLength(0);
    });

    it('keeps escapes and entities literal inside links while expanding mixed outside references', () => {
        const label = String.raw`&#91;&#91;Other&#93;&#93; \[\[Second\]\] \![[Other]] ![[Unselected]] [\[Other\]] \[[Second]\]`;
        const element = render(`[${label}](https://example.org/guide)\n\n[${label}][guide]\n\n&#91;[Other]] \\[[Second]] ![[Second]]\n\n[guide]: https://example.org/guide`);
        const links = [...element.querySelectorAll('a')];
        expect(links).toHaveLength(2);
        expect(links.map(link => link.textContent)).toEqual([
            '[[Other]] [[Second]] ![[Other]] ![[Unselected]] [[Other]] [[Second]]',
            '[[Other]] [[Second]] ![[Other]] ![[Unselected]] [[Other]] [[Second]]',
        ]);
        expect(wikiTargets(element)).toEqual(['Other']);
        expect([...element.querySelectorAll('[data-transclusion-target]')].map(node => node.getAttribute('data-transclusion-target'))).toEqual(['Second']);
    });

    it('retains ordinary reference labels in GFM tables and tasks with definitions outside them', () => {
        const element = render('| Link |\n| --- |\n| [**[[Other]]** `left\\|right` $x\\|y$][guide] |\n\n- [ ] [![[Unselected]]][guide] and [[Other]]\n\n[guide]: https://example.org/guide');
        const links = [...element.querySelectorAll('a')];
        expect(links).toHaveLength(2);
        expect(links[0]?.querySelector('strong')?.textContent).toBe('[[Other]]');
        expect(links[0]?.querySelector('code')?.textContent).toBe('left|right');
        expect(links[0]?.querySelector('annotation')?.textContent).toBe(String.raw`x\|y`);
        expect(links[1]?.textContent).toBe('![[Unselected]]');
        expect(element.querySelector('input')?.type).toBe('checkbox');
        expect(wikiTargets(element)).toEqual(['Other']);
        expect(element.querySelectorAll('[data-transclusion-target]')).toHaveLength(0);
    });
});
