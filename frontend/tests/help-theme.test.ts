// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = readFileSync(resolve(process.cwd(), '../docs/learn-overrides/help-theme.js'), 'utf8');
function portal(query = '', saved?: string, dark = false, blocked = false) {
    const location = new URL(`https://gnosi.temenosismael.org/Gnosi/learn/ca/${query}`);
    const page = document.implementation.createHTMLDocument('Help');
    const base = page.createElement('base');
    base.href = location.href;
    page.head.appendChild(base);
    page.body.innerHTML = `
      <a id="article" href="getting-started/?q=notes#steps">Guide</a>
      <a id="language" href="../fr/getting-started/">Français</a>
      <a id="external" href="https://example.com/">External</a>
    `;
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const events = new EventTarget();
    const changes: Array<() => void> = [];
    const media = { matches: dark, addEventListener: (_event: string, callback: () => void) => { changes.push(callback); } };
    const scope = { location, matchMedia: () => media, localStorage: storage, addEventListener: events.addEventListener.bind(events) };
    if (saved) storage.setItem('db-theme', saved);
    if (blocked) Object.defineProperty(scope, 'localStorage', { get: () => { throw new Error('Storage blocked'); } });
    runInNewContext(script, { window: scope, document: page, URL, Element });
    page.dispatchEvent(new Event('DOMContentLoaded'));
    return { page, storage, events, media, changes, scheme: () => page.body.getAttribute('data-md-color-scheme') };
}

describe('published help theme', () => {
    it.each([['light', true, 'default'], ['dark', false, 'slate']] as const)(
        'uses the explicit %s setting even when the system differs', (theme, system, expected) => {
            expect(portal(`?theme=${theme}`, undefined, system).scheme()).toBe(expected);
        },
    );
    it('uses the Gnosi preference on the same web origin and observes changes', () => {
        const page = portal('', 'light', true);
        expect(page.scheme()).toBe('default');
        page.storage.setItem('db-theme', 'dark');
        page.events.dispatchEvent(new StorageEvent('storage', { key: 'db-theme' }));
        expect(page.scheme()).toBe('slate');
    });
    it('follows system changes only for the system preference', () => {
        const page = portal('?theme=system', 'light');
        expect(page.scheme()).toBe('default');
        page.media.matches = true;
        page.changes.forEach(callback => { callback(); });
        expect(page.scheme()).toBe('slate');
        const fixed = portal('?theme=light');
        fixed.media.matches = true;
        fixed.changes.forEach(callback => { callback(); });
        expect(fixed.scheme()).toBe('default');
    });
    it('falls back safely when storage is blocked or the URL setting is invalid', () => {
        expect(portal('?theme=invalid', undefined, true, true).scheme()).toBe('slate');
        expect(portal('?theme=invalid', 'light', true).scheme()).toBe('default');
    });
    it('keeps theme, query and fragment on article and language links without changing external links', () => {
        const { page } = portal('?theme=dark');
        const article = page.querySelector<HTMLAnchorElement>('#article');
        const language = page.querySelector<HTMLAnchorElement>('#language');
        expect(article?.href).toBe('https://gnosi.temenosismael.org/Gnosi/learn/ca/getting-started/?q=notes&theme=dark#steps');
        expect(language?.search).toBe('?theme=dark');
        expect(page.querySelector('#external')?.getAttribute('href')).toBe('https://example.com/');
    });
});
