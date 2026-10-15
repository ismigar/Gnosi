import { describe, expect, it } from 'vitest';
import { embeddedMediaKind, extractSectionMarkdown, MAX_TRANSCLUSION_DEPTH, parseTransclusionReference, resolveTransclusionLocally, transclusionGuard, transclusionKey } from './transclusionModel';

describe('transclusion references', () => {
    it('resolves ids, case-insensitive titles, Markdown extensions and same-note sections', () => {
        const reference = parseTransclusionReference(' Target.md#^Block ', ' Label ');
        expect(reference).toEqual({ target: 'Target', section: '^Block', alias: 'Label' });
        expect(resolveTransclusionLocally(reference.target, { id: 'TARGET' })).toBe('id');
        expect(resolveTransclusionLocally('id', { id: 'Target' })).toBe('id');
        expect(resolveTransclusionLocally('', {}, 'source')).toBe('source');
        expect(resolveTransclusionLocally('Missing', {})).toBeNull();
    });
    it('detects repeated note sections and bounds deep chains while allowing different sections', () => {
        expect(transclusionGuard([transclusionKey('a')], 'a', '')).toBe('cycle');
        expect(transclusionGuard([transclusionKey('a', 'Heading')], 'a', 'HEADING')).toBe('cycle');
        expect(transclusionGuard([transclusionKey('a')], 'a', 'Heading')).toBeNull();
        expect(transclusionGuard(Array.from({ length: MAX_TRANSCLUSION_DEPTH }, (_, index) => transclusionKey(String(index))), 'new', '')).toBe('depth');
    });
    it('distinguishes supported media from ordinary note names', () => {
        expect(embeddedMediaKind('Assets/photo.png')).toBe('image');
        expect(embeddedMediaKind('Audio.m4a')).toBe('audio');
        expect(embeddedMediaKind('Video.webm')).toBe('video');
        expect(embeddedMediaKind('Document.pdf')).toBe('file');
        expect(embeddedMediaKind('Note.md')).toBeNull();
    });
    it('retains parsed definition order without copying outside prose or code examples', () => {
        const source = '```md\n[label]: https://example.invalid/code\n```\n\n[label]: https://example.invalid/first\n\n## Move\n\n[label] ^block\n\n[label]: https://example.invalid/duplicate\n\n## Keep\n\nPrivate outside prose\n';
        for (const section of ['Move', '^block']) {
            const result = extractSectionMarkdown(source, section) ?? '';
            expect(result).toContain('[label]: https://example.invalid/first');
            expect(result.indexOf('https://example.invalid/first')).toBeLessThan(result.indexOf('https://example.invalid/duplicate'));
            expect(result).not.toContain('https://example.invalid/code');
            expect(result).not.toContain('Private outside prose');
        }
    });
});
