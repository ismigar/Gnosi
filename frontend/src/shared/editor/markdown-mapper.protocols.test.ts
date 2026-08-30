import { describe, expect, it } from 'vitest';

import {
    FILE_PROTOCOL_SENTINEL,
    fileUrlToSentinel,
    sentinelToFileUrl,
} from './markdown-mapper';

describe('Markdown mapper file protocol compatibility', () => {
    it('round-trips current file sentinels without changing the path', () => {
        const fileUrl = 'file:///Users/ismael/Project Notes/report (final).pdf';
        const sentinel = fileUrlToSentinel(fileUrl);

        expect(sentinel).toBe(
            `${FILE_PROTOCOL_SENTINEL}/Users/ismael/Project Notes/report (final).pdf`,
        );
        expect(sentinelToFileUrl(sentinel)).toBe(fileUrl);
    });

    it('restores both historical sentinel variants', () => {
        expect(sentinelToFileUrl('https://__gnosi_file_protocol__/tmp/legacy.pdf'))
            .toBe('file:///tmp/legacy.pdf');
        expect(sentinelToFileUrl('https://**gnosi_file_protocol**/tmp/corrupted.pdf'))
            .toBe('file:///tmp/corrupted.pdf');
    });

    it('preserves non-file strings and non-string legacy inputs', () => {
        const marker = { href: 'file:///tmp/not-a-string-boundary' };

        expect(fileUrlToSentinel('https://example.com/file.pdf'))
            .toBe('https://example.com/file.pdf');
        expect(sentinelToFileUrl(marker)).toBe(marker);
        expect(fileUrlToSentinel(null)).toBeNull();
    });
});
