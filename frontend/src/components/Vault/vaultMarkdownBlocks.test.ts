import { describe, expect, it } from 'vitest';

import { parseVaultMarkdownBlocks } from './vaultMarkdownBlocks';

describe('parseVaultMarkdownBlocks', () => {
  it('extracts toggle headings and keeps their children nested', () => {
    const blocks = parseVaultMarkdownBlocks(
      [
        ':::toggle-heading{level=1} Planificació',
        '## Tasques',
        ':::toggle Recursos',
        'Enllaç',
        ':::',
        ':::',
      ].join('\n'),
    );

    expect(blocks).toHaveLength(1);
    const rootBlock = blocks[0];
    expect(rootBlock).toMatchObject({
      type: 'toggle-heading',
      level: 1,
      label: 'Planificació',
    });
    if (!rootBlock || rootBlock.type === 'markdown') {
      throw new Error('Expected a toggle-heading root block.');
    }
    expect(rootBlock.children[0]).toMatchObject({
      type: 'markdown',
      content: '## Tasques',
    });
    expect(rootBlock.children[1]).toMatchObject({
      type: 'toggle',
      label: 'Recursos',
    });
  });

  it('does not interpret toggle syntax inside code fences', () => {
    const blocks = parseVaultMarkdownBlocks(
      [
        '```md',
        ':::toggle-heading{level=1} Example',
        ':::',
        '```',
      ].join('\n'),
    );

    expect(blocks).toEqual([
      {
        type: 'markdown',
        content: '```md\n:::toggle-heading{level=1} Example\n:::\n```',
      },
    ]);
  });
});
