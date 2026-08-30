import { describe, expect, it } from 'vitest';

import { blocksToRichMarkdown, richMarkdownToBlocks } from './markdown-mapper';

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeBlocks(blocks: unknown): string {
    const markdown: unknown = blocksToRichMarkdown(blocks);
    if (typeof markdown !== 'string') {
        throw new Error('Expected the Markdown mapper to return text');
    }
    return markdown;
}

async function parseBlocks(markdown: string, editor: unknown): Promise<unknown[]> {
    const blocks: unknown = await richMarkdownToBlocks(markdown, editor);
    if (!isUnknownArray(blocks)) {
        throw new Error('Expected the Markdown mapper to return blocks');
    }
    return blocks;
}

describe('inline icon markdown mapping', () => {
    it('serializes non-text icons as encoded Gnosi tokens', () => {
        const markdown = serializeBlocks([{
            type: 'paragraph',
            content: [
                { type: 'text', text: 'Before ', styles: {} },
                { type: 'inlineIcon', props: { value: 'lucide:Brain:purple' } },
                { type: 'text', text: ' after', styles: {} },
            ],
        }]);

        expect(markdown).toContain('{{gnosi-icon:lucide%3ABrain%3Apurple}}');
    });

    it('restores encoded Gnosi tokens as inline icons', async () => {
        const editor = {
            tryParseMarkdownToBlocks: (markdown: string) => Promise.resolve([{
                type: 'paragraph',
                content: [{ type: 'text', text: markdown, styles: {} }],
            }]),
        };

        const blocks = await parseBlocks(
            'Before {{gnosi-icon:%2Fapi%2Fvault%2Fassets%2Fcustom.png}} after',
            editor,
        );

        const paragraph = blocks.at(0);
        expect(isRecord(paragraph)).toBe(true);
        if (!isRecord(paragraph)) throw new Error('Expected a paragraph block');
        expect(paragraph.content).toEqual([
            { type: 'text', text: 'Before ', styles: {} },
            { type: 'inlineIcon', props: { value: '/api/vault/assets/custom.png' } },
            { type: 'text', text: ' after', styles: {} },
        ]);
    });

    it('keeps malformed legacy icon tokens visible instead of rejecting the page', async () => {
        const editor = {
            tryParseMarkdownToBlocks: (markdown: string) => Promise.resolve([{
                type: 'paragraph',
                content: [{ type: 'text', text: markdown, styles: {} }],
            }]),
        };

        const blocks = await parseBlocks('Icon {{gnosi-icon:%E0%A4%A}}', editor);
        const paragraph = blocks.at(0);
        if (!isRecord(paragraph) || !isUnknownArray(paragraph.content)) {
            throw new Error('Expected paragraph inline content');
        }

        expect(paragraph.content).toEqual([
            { type: 'text', text: 'Icon ', styles: {} },
            { type: 'inlineIcon', props: { value: '%E0%A4%A' } },
        ]);
    });
});
