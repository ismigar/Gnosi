import { describe, expect, it } from 'vitest';

import { blocksToRichMarkdown, richMarkdownToBlocks } from './markdown-mapper';

const text = (value: string) => [{ type: 'text', text: value, styles: {} }];

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(values: readonly unknown[], index: number): Record<string, unknown> {
    const value = values.at(index);
    if (!isRecord(value)) throw new Error(`Expected record at index ${String(index)}`);
    return value;
}

function recordChildren(record: Readonly<Record<string, unknown>>): Record<string, unknown>[] {
    const { children } = record;
    if (!isUnknownArray(children)) throw new Error('Expected block children');
    return children.map((child, index) => recordAt(children, index));
}

function serializeBlocks(blocks: unknown, editor?: unknown): string {
    const markdown: unknown = blocksToRichMarkdown(blocks, editor);
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

const parserEditor = {
    tryParseMarkdownToBlocks: (markdown: string) => {
        const blocks: Array<Record<string, unknown>> = [];
        for (const rawLine of (markdown || '').split('\n')) {
            const line = rawLine.trim();
            if (!line) continue;
            const heading = line.match(/^(#{1,6})\s+(.+)$/);
            const headingMarks = heading?.[1];
            const headingText = heading?.[2];
            if (headingMarks !== undefined && headingText !== undefined) {
                blocks.push({
                    type: 'heading',
                    props: { level: headingMarks.length },
                    content: text(headingText),
                });
                continue;
            }
            const file = line.match(/^\[file:\s*([^\]]+)\]\(([^)]+)\)$/);
            const fileLabel = file?.[1];
            const fileHref = file?.[2];
            if (fileLabel !== undefined && fileHref !== undefined) {
                blocks.push({
                    type: 'paragraph',
                    content: [{
                        type: 'link',
                        href: fileHref,
                        content: text(`file: ${fileLabel}`),
                    }],
                });
                continue;
            }
            blocks.push({ type: 'paragraph', content: text(line) });
        }
        return Promise.resolve(blocks);
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

        const markdown = serializeBlocks(source);
        const restored = await parseBlocks(markdown, parserEditor);
        const callout = recordAt(restored, 0);
        const calloutChildren = recordChildren(callout);

        expect(markdown).toContain(':::callout{type=info}');
        expect(markdown).toContain(':::column-list');
        expect(markdown).toContain('[file: /api/vault/assets/guide.pdf](/api/vault/assets/guide.pdf)');
        expect(markdown).toContain(':::callout{type=warning}');
        expect(restored).toHaveLength(1);
        expect(callout.type).toBe('alert');
        expect(calloutChildren.map(block => block.type)).toEqual([
            'paragraph',
            'heading',
            'columnList',
            'alert',
        ]);
        const columnList = recordAt(calloutChildren, 2);
        const secondColumn = recordAt(recordChildren(columnList), 1);
        expect(recordAt(recordChildren(secondColumn), 0).type).toBe('file');
        const nestedCallout = recordAt(calloutChildren, 3);
        expect(nestedCallout.props).toEqual(expect.objectContaining({ type: 'warning' }));
    });

    it('promotes legacy Obsidian callouts to nested blocks', async () => {
        const restored = await parseBlocks(
            '> [!warning]\n> ## Important\n> [file: guide.pdf](/assets/guide.pdf)',
            parserEditor,
        );

        const callout = recordAt(restored, 0);
        expect(callout).toMatchObject({
            type: 'alert',
            props: { type: 'warning' },
        });
        expect(callout.content).toBeUndefined();
        expect(recordChildren(callout).map(block => block.type)).toEqual(['heading', 'file']);
        expect(serializeBlocks(restored)).toContain(':::callout{type=warning}');
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
                        content: text(`Column ${String(index + 1)}`),
                    }],
                })),
            }],
        }];

        const markdown = serializeBlocks(source);
        const restored = await parseBlocks(markdown, parserEditor);
        const callout = recordAt(restored, 0);
        const columnList = recordAt(recordChildren(callout), 0);
        const columns = recordChildren(columnList);

        expect(columns).toHaveLength(5);
        expect(columns.map(column => {
            const paragraph = recordAt(recordChildren(column), 0);
            const content = paragraph.content;
            if (!isUnknownArray(content)) throw new Error('Expected paragraph content');
            return recordAt(content, 0).text;
        })).toEqual([
            'Column 1',
            'Column 2',
            'Column 3',
            'Column 4',
            'Column 5',
        ]);
    });

    it('falls back to an editable info callout for invalid or empty input', async () => {
        const restored = await parseBlocks(
            ':::callout{type=unknown}\n:::',
            parserEditor,
        );

        const callout = recordAt(restored, 0);
        expect(callout.props).toEqual(expect.objectContaining({ type: 'info' }));
        expect(callout.children).toEqual([
            expect.objectContaining({ type: 'paragraph', content: [] }),
        ]);
    });
});
