import { afterEach, describe, expect, it } from 'vitest';
import { removeStorage } from '../platform/browser-storage';
import { applyCustomAppearance, customAppearanceKey, readCustomAppearance, resetCustomAppearance, saveCustomAppearance, validateCustomCss, type CustomAppearance } from './customAppearance';

const fixture: CustomAppearance = {
    activeTheme: 'forest', themes: [{ id: 'forest', name: 'Forest', enabled: false, css: ':root { --gnosi-primary: green; }' }],
    snippets: [{ id: 'spacing', name: 'Spacing', css: '.vault-page-editor { padding: 12px; }', enabled: true }],
};
afterEach(() => { removeStorage(customAppearanceKey); document.getElementById('gnosi-custom-appearance')?.remove(); window.history.replaceState({}, '', '/'); });
describe('custom appearance', () => {
    it.each(['@import "https://example.test/a.css";', '.x { background: url(https://example.test/a); }',
        '@im\\70ort "https://example.test/a.css";', '.x { background: u/**/rl(https://example.test/a); }',
        '.x { background: image-set("https://example.test/a"); }', '.x { background: s\\72 c("https://example.test/a"); }'])('rejects network-bearing CSS: %s', css => {
        expect(validateCustomCss(css)).toBe('external');
        expect(saveCustomAppearance({ ...fixture, themes: [{ id: 'forest', name: 'Forest', enabled: false, css }] })).toBe(false);
    });
    it('applies saved themes and snippets on direct load and resets their effects without deleting the CSS', () => {
        expect(saveCustomAppearance(fixture)).toBe(true);
        expect(document.getElementById('gnosi-custom-appearance')?.textContent).toContain('padding: 12px');
        document.getElementById('gnosi-custom-appearance')?.remove();
        applyCustomAppearance();
        expect(document.getElementById('gnosi-custom-appearance')?.textContent).toContain('--gnosi-primary: green');
        expect(resetCustomAppearance()).toBe(true);
        expect(document.getElementById('gnosi-custom-appearance')).toBeNull();
        expect(readCustomAppearance().themes[0]?.css).toBe(fixture.themes[0]?.css);
        expect(readCustomAppearance().snippets[0]?.enabled).toBe(false);
    });
    it('offers a safe-mode URL even when custom CSS hides controls', () => {
        window.history.replaceState({}, '', '/?gnosi-safe-appearance=1');
        expect(saveCustomAppearance(fixture)).toBe(true);
        expect(document.getElementById('gnosi-custom-appearance')).toBeNull();
        expect(readCustomAppearance().activeTheme).toBe('forest');
    });
});
