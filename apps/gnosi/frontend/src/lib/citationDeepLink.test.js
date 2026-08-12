import { describe, expect, it } from 'vitest';

import {
    CITATION_PROTOCOL_SENTINEL,
    citationParamsFromHref,
    citationSentinelToHref,
    protectCitationMarkdownLinks,
} from './citationDeepLink';
import {
    blocksToRichMarkdown,
    richMarkdownToBlocks,
} from '../components/Vault/markdown-mapper';

describe('citation deep links', () => {
    it('protects custom protocols for BlockNote and restores them for Markdown', () => {
        const original = '[p. 7, ¶ 2](gnosi-cite:?res=resource-1&page=7&paragraph=2)';
        const protectedMarkdown = protectCitationMarkdownLinks(original);

        expect(protectedMarkdown).toBe(
            `[p. 7, ¶ 2](${CITATION_PROTOCOL_SENTINEL}?res=resource-1&page=7&paragraph=2)`,
        );
        expect(citationSentinelToHref(`${CITATION_PROTOCOL_SENTINEL}?res=resource-1&page=7`))
            .toBe('gnosi-cite:?res=resource-1&page=7');
    });

    it('reads the provenance query from a protected editor link', () => {
        const params = citationParamsFromHref(
            `${CITATION_PROTOCOL_SENTINEL}?res=resource-1&snapshot=snapshot-1&segment=segment-1&page=7`,
        );

        expect(params?.get('res')).toBe('resource-1');
        expect(params?.get('snapshot')).toBe('snapshot-1');
        expect(params?.get('segment')).toBe('segment-1');
        expect(params?.get('page')).toBe('7');
    });

    it('round-trips a citation through the BlockNote-safe sentinel', async () => {
        const original = '[p. 7](gnosi-cite:?res=resource-1&page=7)';
        let parsedMarkdown = '';
        const editor = {
            tryParseMarkdownToBlocks: async (markdown) => {
                parsedMarkdown = markdown;
                return [{
                    type: 'paragraph',
                    content: [{
                        type: 'link',
                        href: `${CITATION_PROTOCOL_SENTINEL}?res=resource-1&page=7`,
                        content: [{ type: 'text', text: 'p. 7', styles: {} }],
                    }],
                }];
            },
        };

        const blocks = await richMarkdownToBlocks(original, editor);

        expect(parsedMarkdown).toContain(CITATION_PROTOCOL_SENTINEL);
        expect(blocksToRichMarkdown(blocks, editor)).toBe(original);
    });
});
