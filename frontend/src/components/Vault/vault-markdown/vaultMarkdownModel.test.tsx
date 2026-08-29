import { describe, expect, it } from 'vitest';

import {
    citationEvidence,
    latexFencesToMath,
    reactNodeText,
} from './vaultMarkdownModel';


describe('vaultMarkdownModel', () => {
    it('converts only LaTeX and math fences to display math', () => {
        expect(latexFencesToMath('```latex\nx^2\n```'))
            .toBe('\n$$\nx^2\n$$\n');
        expect(latexFencesToMath('```js\nx^2\n```'))
            .toBe('```js\nx^2\n```');
    });

    it('extracts nested text from markdown link children', () => {
        expect(reactNodeText(<><span>Gnosi</span> 3</>, 'fallback')).toBe('Gnosi 3');
        expect(reactNodeText(null, 'fallback')).toBe('fallback');
    });

    it('narrows citation evidence without leaking untyped properties', () => {
        expect(citationEvidence({
            label: 'Paper',
            segment: { text: 'Relevant excerpt', score: 0.9 },
            source_url: 'https://example.test/paper',
            unexpected: true,
        })).toEqual({
            label: 'Paper',
            segment: { text: 'Relevant excerpt' },
            source_url: 'https://example.test/paper',
        });
        expect(citationEvidence('invalid')).toBeNull();
    });
});
