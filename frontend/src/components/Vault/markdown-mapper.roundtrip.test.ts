import { describe, expect, it, vi } from 'vitest';

import { CITATION_PROTOCOL_SENTINEL } from '../../lib/citationDeepLink';
import { blocksToRichMarkdown, richMarkdownToBlocks } from './markdown-mapper';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) throw new Error('Expected a block collection');
    return value.map((item) => {
        if (!isRecord(item)) throw new Error('Expected a block record');
        return item;
    });
}

function inlineText(value: string): unknown[] {
    return [{ type: 'text', text: value, styles: {} }];
}

describe('Markdown mapper serialization domains', () => {
    it('serializes lists tightly and appends stable footnote definitions', () => {
        const markdown = blocksToRichMarkdown([
            { type: 'bulletListItem', content: inlineText('First') },
            { type: 'bulletListItem', content: inlineText('Second') },
            {
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'Reference ', styles: {} },
                    { type: 'footnote', props: { id: 'shared', content: 'Source note' } },
                    { type: 'text', text: ' again ', styles: {} },
                    { type: 'footnote', props: { id: 'shared', content: 'Ignored duplicate' } },
                ],
            },
        ]);

        expect(markdown).toBe(
            '- First\n- Second\n\nReference [^1] again [^1]\n\n[^1]: Source note',
        );
    });

    it('preserves enriched inline marks, links, mentions, dates, and citations', () => {
        const markdown = blocksToRichMarkdown([{
            type: 'paragraph',
            content: [
                { type: 'text', text: 'Bold', styles: { bold: true } },
                { type: 'text', text: ' ', styles: {} },
                { type: 'wikilink', props: { target: 'Page', title: 'Alias' } },
                { type: 'text', text: ' ', styles: {} },
                { type: 'cite', props: { citationKey: 'smith2020' } },
                { type: 'text', text: ' ', styles: {} },
                { type: 'mention', props: { name: 'Ada', id: 'person-1' } },
                { type: 'text', text: ' ', styles: {} },
                { type: 'dateref', props: { date: '2026-08-30', time: '09:15' } },
            ],
        }]);

        expect(markdown).toBe(
            '**Bold** [[Page|Alias]] [@smith2020] @[Ada|person-1] @2026-08-30T09:15',
        );
    });

    it('aborts serialization rather than writing opaque object text', () => {
        expect(() => blocksToRichMarkdown([{
            type: 'paragraph',
            props: { textColor: {} },
            content: inlineText('Unsafe style'),
        }])).toThrow("detected '[object Object]'");
    });
});

describe('Markdown mapper parsing domains', () => {
    it('protects file and citation protocols plus unknown HTML before parsing', async () => {
        const parser = vi.fn<(markdown: string) => Promise<unknown[]>>((markdown) =>
            Promise.resolve([{ type: 'paragraph', content: inlineText(markdown) }])
        );

        await richMarkdownToBlocks(
            '[File](file:///tmp/My File.pdf)\n'
            + '[Citation](gnosi-cite:?res=r1&page=7)\n'
            + '<meeting-notes>Keep me</meeting-notes>',
            { tryParseMarkdownToBlocks: parser },
        );

        const parsedMarkdown = parser.mock.calls[0]?.[0] ?? '';
        expect(parsedMarkdown).toContain('https://gnosi-file-protocol.local/tmp/My File.pdf');
        expect(parsedMarkdown).toContain(CITATION_PROTOCOL_SENTINEL);
        expect(parsedMarkdown).toContain('`<meeting-notes>`Keep me`</meeting-notes>`');
    });

    it('promotes media, bibliography, table of contents, and custom fences', async () => {
        const parser = {
            tryParseMarkdownToBlocks: (_markdown: string): Promise<unknown[]> =>
                Promise.resolve([
                    {
                        type: 'paragraph',
                        content: [{
                            type: 'link',
                            href: '/assets/guide.pdf',
                            content: inlineText('file: guide.pdf'),
                        }],
                    },
                    { type: 'paragraph', content: inlineText('{{bibliography}}') },
                    { type: 'paragraph', content: inlineText('{{toc}}') },
                    {
                        type: 'codeBlock',
                        props: { language: 'mermaid' },
                        content: inlineText('graph TD; A-->B'),
                    },
                ]),
        };

        const blocks = records(await richMarkdownToBlocks(
            '[file: guide.pdf](/assets/guide.pdf)\n\n'
            + '{{bibliography}}\n\n{{toc}}\n\n'
            + '```mermaid\ngraph TD; A-->B\n```',
            parser,
        ));

        expect(blocks.map((block) => block.type)).toEqual([
            'file',
            'bibliography',
            'tableOfContents',
            'mermaid',
        ]);
    });

    it('preserves the legacy synced-block fallback for malformed and scalar JSON', async () => {
        const parse = async (content: string): Promise<Record<string, unknown>> => {
            const blocks = records(await richMarkdownToBlocks(content, {
                tryParseMarkdownToBlocks: (): Promise<unknown[]> => Promise.resolve([{
                    type: 'codeBlock',
                    props: { language: 'gnosi-synced' },
                    content: inlineText(content),
                }]),
            }));
            return blocks[0] ?? {};
        };

        expect(await parse('{"sync_id":"shared-page"}')).toMatchObject({
            type: 'synced',
            props: { sync_id: 'shared-page' },
        });
        expect(await parse('"legacy-scalar"')).toMatchObject({
            type: 'synced',
            props: { sync_id: '' },
        });
        expect(await parse('legacy-id')).toMatchObject({
            type: 'synced',
            props: { sync_id: 'legacy-id' },
        });
    });

    it('parses GFM cells as inline Markdown and preserves escaped pipes', async () => {
        const parser = {
            tryParseMarkdownToBlocks: (markdown: string): Promise<unknown[]> => Promise.resolve([{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: markdown.startsWith('**') && markdown.endsWith('**')
                        ? markdown.slice(2, -2)
                        : markdown,
                    styles: { bold: markdown.startsWith('**') && markdown.endsWith('**') },
                }],
            }]),
        };

        const blocks = records(await richMarkdownToBlocks(
            '| Name | Detail |\n| --- | --- |\n| **Ada** | A \\| B |',
            parser,
        ));
        const table = blocks[0];
        if (!table || !isRecord(table.content)) throw new Error('Expected table content');
        const rows = table.content.rows;

        expect(table.type).toBe('table');
        expect(Array.isArray(rows)).toBe(true);
        expect(rows).toHaveLength(2);
        expect(blocksToRichMarkdown(blocks)).toContain('| **Ada** | A \\| B |');
    });

    it('restores footnote definitions while leaving fenced examples untouched', async () => {
        let parserInput = '';
        const parser = {
            tryParseMarkdownToBlocks: (markdown: string): Promise<unknown[]> => {
                parserInput = markdown;
                return Promise.resolve([
                    { type: 'paragraph', content: inlineText('Body [^note]') },
                ]);
            },
        };

        const blocks = records(await richMarkdownToBlocks(
            'Body [^note]\n\n[^note]: Definition\n\n```text\n[^code]: literal\n```',
            parser,
        ));
        const paragraphContent = records(blocks[0]?.content);

        expect(paragraphContent.some((item) => item.type === 'footnote')).toBe(true);
        expect(blocksToRichMarkdown(blocks)).toContain('[^1]: Definition');
        expect(parserInput).toContain('```text\n[^code]: literal\n```');
    });
});
