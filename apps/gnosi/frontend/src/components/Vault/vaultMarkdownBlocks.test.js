import { describe, expect, it } from 'vitest';

import { parseVaultMarkdownBlocks } from './vaultMarkdownBlocks';

describe('parseVaultMarkdownBlocks', () => {
    it('extracts toggle headings and keeps their children nested', () => {
        const blocks = parseVaultMarkdownBlocks([
            ':::toggle-heading{level=1} Planificació',
            '## Tasques',
            ':::toggle Recursos',
            'Enllaç',
            ':::',
            ':::',
        ].join('\n'));

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({ type: 'toggle-heading', level: 1, label: 'Planificació' });
        expect(blocks[0].children[0]).toMatchObject({ type: 'markdown', content: '## Tasques' });
        expect(blocks[0].children[1]).toMatchObject({ type: 'toggle', label: 'Recursos' });
    });

    it('does not interpret toggle syntax inside code fences', () => {
        const blocks = parseVaultMarkdownBlocks([
            '```md',
            ':::toggle-heading{level=1} Example',
            ':::',
            '```',
        ].join('\n'));

        expect(blocks).toEqual([{
            type: 'markdown',
            content: '```md\n:::toggle-heading{level=1} Example\n:::\n```',
        }]);
    });
});
