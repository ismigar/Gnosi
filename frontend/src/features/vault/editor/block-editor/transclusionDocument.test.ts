import { describe, expect, it } from 'vitest';
import { replaceTransclusion, transclusionRange } from './transclusionDocument';

describe('transclusion source ranges', () => {
    function rangeFor(source: string, section: string) {
        const range = transclusionRange(source, section);
        if (!range) throw new Error('Missing section');
        return range;
    }
    it('keeps complete rich Markdown without truncation', () => {
        const source = '# Title\n' + '**Formatted** text\n'.repeat(100) + '```js\n1 + 1\n```\n';
        expect(source.slice(rangeFor(source, '').start, rangeFor(source, '').end)).toBe(source);
    });
    it('replaces only a section including its subsections and code', () => {
        const source = '# Before\nKeep\n# Target\nOld\n## Child\n```md\n# Target\n```\n# After\nKeep too\n';
        const range = rangeFor(source, 'Target');
        expect(source.slice(range.start, range.end)).toBe('Old\n## Child\n```md\n# Target\n```\n');
        expect(replaceTransclusion(source, range, '**New**')).toBe('# Before\nKeep\n# Target\n**New**\n# After\nKeep too\n');
    });
    it('allows an empty section without falling back to the whole note', () => {
        const source = '# Target\n# Other\nKeep\n';
        const range = rangeFor(source, 'Target');
        expect(range.start).toBe(range.end);
        expect(replaceTransclusion(source, range, 'Added')).toBe('# Target\nAdded\n# Other\nKeep\n');
    });
    it('does not match headings or block markers in fences', () => {
        const source = '~~~md\n# Hidden\nText ^block\n~~~\n';
        expect(transclusionRange(source, 'Hidden')).toBeNull();
        expect(transclusionRange(source, '^block')).toBeNull();
    });
    it('preserves block anchors and unrelated content', () => {
        const source = 'Before\nOriginal ^anchor\nAfter\n';
        const range = rangeFor(source, '^anchor');
        expect(replaceTransclusion(source, range, 'Edited\n')).toBe('Before\nEdited ^anchor\nAfter\n');
    });
    it('returns null for missing references', () => {
        expect(transclusionRange('# Present\nBody', 'Missing')).toBeNull();
    });
});
