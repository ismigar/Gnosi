import { describe, expect, it } from 'vitest';

import { basenameOf, detectEmbedKind, toFileUrl } from './richLinkModel';


describe('rich link model', () => {
    it('normalizes POSIX, Windows, UNC, and existing file URLs', () => {
        expect(toFileUrl('/Users/ismael/document.pdf')).toBe(
            'file:///Users/ismael/document.pdf',
        );
        expect(toFileUrl('C:\\Users\\ismael\\document.pdf')).toBe(
            'file:///C:/Users/ismael/document.pdf',
        );
        expect(toFileUrl('\\\\server\\share\\file.txt')).toBe(
            'file://server/share/file.txt',
        );
        expect(toFileUrl('file:///tmp/file.txt')).toBe('file:///tmp/file.txt');
    });

    it('derives portable labels from both path separators', () => {
        expect(basenameOf('/Users/ismael/document.pdf')).toBe('document.pdf');
        expect(basenameOf('C:\\Users\\ismael\\folder\\')).toBe('folder');
    });

    it('detects media kinds without query-string interference', () => {
        expect(detectEmbedKind('https://example.com/image.webp?v=2')).toBe('image');
        expect(detectEmbedKind('movie.mp4')).toBe('video');
        expect(detectEmbedKind('audio.flac')).toBe('audio');
        expect(detectEmbedKind('document.pdf')).toBe('file');
    });
});
