import { describe, expect, it } from 'vitest';

import { normalizeManagedBlockSpacing, stripManagedBlockMarkers } from './managedMarkdownUtils';

describe('normalizeManagedBlockSpacing', () => {
    it('separates managed markers from a tight ordered list', () => {
        const markdown = [
            '<!-- gnosi:llm-wiki:start resource:source:record -->',
            '1. [[note-1|First note]]',
            '2. [[note-2|Second note]]',
            '<!-- gnosi:llm-wiki:end resource:source:record -->',
        ].join('\n');

        expect(normalizeManagedBlockSpacing(markdown)).toBe([
            '<!-- gnosi:llm-wiki:start resource:source:record -->',
            '',
            '1. [[note-1|First note]]',
            '2. [[note-2|Second note]]',
            '',
            '<!-- gnosi:llm-wiki:end resource:source:record -->',
        ].join('\n'));
    });

    it('is idempotent and ignores marker examples inside fenced code', () => {
        const markdown = [
            '<!-- gnosi:llm-wiki:start general -->',
            '',
            '- [[index-1|Index]]',
            '',
            '<!-- gnosi:llm-wiki:end general -->',
            '',
            '```md',
            '<!-- gnosi:llm-wiki:start example -->',
            '- example',
            '<!-- gnosi:llm-wiki:end example -->',
            '```',
        ].join('\n');

        const normalized = normalizeManagedBlockSpacing(markdown);

        expect(normalized).toBe(markdown);
        expect(normalizeManagedBlockSpacing(normalized)).toBe(markdown);
    });
});

describe('stripManagedBlockMarkers', () => {
    it('hides boundary metadata while preserving the managed Markdown', () => {
        const markdown = [
            '<!-- gnosi:llm-wiki:start resource:source:record -->',
            '1. [[note-1|First note]]',
            '<!-- gnosi:llm-wiki:end resource:source:record -->',
        ].join('\n');

        expect(stripManagedBlockMarkers(markdown)).toBe('1. [[note-1|First note]]');
    });

    it('keeps marker examples inside fenced code', () => {
        const markdown = [
            '```md',
            '<!-- gnosi:llm-wiki:start example -->',
            '```',
        ].join('\n');

        expect(stripManagedBlockMarkers(markdown)).toBe(markdown);
    });
});
