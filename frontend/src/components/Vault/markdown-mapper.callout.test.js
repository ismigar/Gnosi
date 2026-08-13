import { describe, expect, it } from 'vitest';

import { blocksToRichMarkdown, richMarkdownToBlocks } from './markdown-mapper';

const text = (value) => [{ type: 'text', text: value, styles: {} }];

const parserEditor = {
    tryParseMarkdownToBlocks: async (markdown) => {
        const blocks = [];
        for (const rawLine of String(markdown || '').split('\n')) {
            const line = rawLine.trim();
            if (!line) continue;
            const heading = line.match(/^(#{1,6})\s+(.+)$/);
            if (heading) {
                blocks.push({
                    type: 'heading',
                    props: { level: heading[1].length },
                    content: text(heading[2]),
                });
                continue;
            }
            const file = line.match(/^\[file:\s*([^\]]+)\]\(([^)]+)\)$/);
            if (file) {
                blocks.push({
                    type: 'paragraph',
                    content: [{
                        type: 'link',
                        href: file[2],
                        content: text(`file: ${file[1]}`),
                    }],
                });
                continue;
            }
            blocks.push({ type: 'paragraph', content: text(line) });
        }
        return blocks;
    },
};

describe('nested callout Markdown mapping', () => {
    it('round-trips headings, columns, files, and nested callouts as children', async () => {
        const source = [{
            type: 'alert',
            props: { type: 'info' },
            children: [
                { type: 'paragraph', content: text('Introduction') },
                { type: 'heading', props: { level: 2 }, content: text('Resources') },
                {
                    type: 'columnList',
                    children: [
                        {
                            type: 'column',
                            props: { width: 1 },
                            children: [{ type: 'paragraph', content: text('Left') }],
                        },
                        {
                            type: 'column',
                            props: { width: 1 },
                            children: [{ type: 'file', props: { url: '/api/vault/assets/guide.pdf' } }],
                        },
                    ],
                },
                {
                    type: 'alert',
                    props: { type: 'warning' },
                    children: [{ type: 'paragraph', content: text('Nested warning') }],
                },
            ],
        }];

        const markdown = blocksToRichMarkdown(source);
        const restored = await richMarkdownToBlocks(markdown, parserEditor);

        expect(markdown).toContain(':::callout{type=info}');
        expect(markdown).toContain(':::column-list');
        expect(markdown).toContain('[file: /api/vault/assets/guide.pdf](/api/vault/assets/guide.pdf)');
        expect(markdown).toContain(':::callout{type=warning}');
        expect(restored).toHaveLength(1);
        expect(restored[0].type).toBe('alert');
        expect(restored[0].children.map((block) => block.type)).toEqual([
            'paragraph',
            'heading',
            'columnList',
            'alert',
        ]);
        expect(restored[0].children[2].children[1].children[0].type).toBe('file');
        expect(restored[0].children[3].props.type).toBe('warning');
    });

    it('promotes legacy Obsidian callouts to nested blocks', async () => {
        const restored = await richMarkdownToBlocks(
            '> [!warning]\n> ## Important\n> [file: guide.pdf](/assets/guide.pdf)',
            parserEditor,
        );

        expect(restored[0]).toMatchObject({
            type: 'alert',
            props: { type: 'warning' },
        });
        expect(restored[0].content).toBeUndefined();
        expect(restored[0].children.map((block) => block.type)).toEqual(['heading', 'file']);
        expect(blocksToRichMarkdown(restored)).toContain(':::callout{type=warning}');
    });

    it('round-trips a five-column layout inside a callout', async () => {
        const source = [{
            type: 'alert',
            props: { type: 'info' },
            children: [{
                type: 'columnList',
                children: Array.from({ length: 5 }, (_, index) => ({
                    type: 'column',
                    props: { width: 1 },
                    children: [{
                        type: 'paragraph',
                        content: text(`Column ${index + 1}`),
                    }],
                })),
            }],
        }];

        const markdown = blocksToRichMarkdown(source);
        const restored = await richMarkdownToBlocks(markdown, parserEditor);
        const columns = restored[0].children[0].children;

        expect(columns).toHaveLength(5);
        expect(columns.map(column => column.children[0].content[0].text)).toEqual([
            'Column 1',
            'Column 2',
            'Column 3',
            'Column 4',
            'Column 5',
        ]);
    });

    it('falls back to an editable info callout for invalid or empty input', async () => {
        const restored = await richMarkdownToBlocks(
            ':::callout{type=unknown}\n:::',
            parserEditor,
        );

        expect(restored[0].props.type).toBe('info');
        expect(restored[0].children).toEqual([expect.objectContaining({ type: 'paragraph', content: [] })]);
    });
});
