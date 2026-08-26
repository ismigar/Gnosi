import { describe, expect, it } from 'vitest';

import { blocksToRichMarkdown, richMarkdownToBlocks } from './markdown-mapper';

describe('inline icon markdown mapping', () => {
    it('serializes non-text icons as encoded Gnosi tokens', () => {
        const markdown = blocksToRichMarkdown([{
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
            tryParseMarkdownToBlocks: async (markdown) => [{
                type: 'paragraph',
                content: [{ type: 'text', text: markdown, styles: {} }],
            }],
        };

        const blocks = await richMarkdownToBlocks(
            'Before {{gnosi-icon:%2Fapi%2Fvault%2Fassets%2Fcustom.png}} after',
            editor,
        );

        expect(blocks[0].content).toEqual([
            { type: 'text', text: 'Before ', styles: {} },
            { type: 'inlineIcon', props: { value: '/api/vault/assets/custom.png' } },
            { type: 'text', text: ' after', styles: {} },
        ]);
    });
});
