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

it('preserves fenced directive examples inside callouts and subsequent sibling text', () => {
  const blocks = parseVaultMarkdownBlocks([':::callout{type=warning}', '```md', ':::column', ':::', '```',
    ':::', 'After', ':::column-list', ':::column {width=2}', 'Left', ':::', ':::column', 'Right', ':::', ':::'].join('\n'));
  expect(blocks).toMatchObject([
    { type: 'callout', tone: 'warning', children: [{ type: 'markdown', content: '```md\n:::column\n:::\n```' }] },
    { type: 'markdown', content: 'After' },
    { type: 'column-list', children: [{ type: 'column', width: 2 }, { type: 'column', width: 1 }] },
  ]);
});

it('removes editor indentation from structural children without flattening lists or literal code examples', () => {
  const body = [':::column-list', ':::column', '  ## Heading', '    **Rich text**', '    - Parent', '      - Child',
    '    ```md', '    :::callout{type=info}', '      code', '    :::', '    ```', ':::', ':::'].join('\n');
  expect(parseVaultMarkdownBlocks(body)).toMatchObject([{ type: 'column-list', children: [
    { type: 'column', children: [{ type: 'markdown', content: '## Heading\n**Rich text**\n- Parent\n  - Child\n```md\n:::callout{type=info}\n  code\n:::\n```' }] },
  ] }]);
});

it('keeps literal indented directive examples outside containers', () => {
  const code = '    :::column\n    literal\n    :::';
  expect(parseVaultMarkdownBlocks(code)).toEqual([{ type: 'markdown', content: code }]);
});
