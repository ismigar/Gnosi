import { describe, expect, it } from 'vitest';
import { extractSectionMarkdown, listSectionReferences } from './transclusionModel';

describe('bookmark section choices', () => {
    it('offers formatted and setext headings and marked passages that can be opened', () => {
        const markdown = '# **First** topic\n\nBody\n\nSecond topic\n------------\n\nA marked paragraph ^passage\n\n```md\n# Example only\nHidden ^code\n```\n\n    # Indented example\n';
        const choices = listSectionReferences(markdown);
        expect(choices).toEqual([
            { target: 'first topic', label: 'First topic' },
            { target: 'second topic', label: 'Second topic' },
            { target: '^passage', label: 'A marked paragraph' },
        ]);
        for (const choice of choices) expect(extractSectionMarkdown(markdown, choice.target)).not.toBeNull();
    });
});
