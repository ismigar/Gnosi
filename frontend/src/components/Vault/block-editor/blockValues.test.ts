import { describe, expect, it } from 'vitest';
import { createEditorSchema } from './schema';
import { readEditorBlocks, sanitizeBlocks } from './blockValues';
import { richMarkdownToBlocks, blocksToRichMarkdown } from '../markdown-mapper';
import type { VaultEditorContextValue } from '../VaultEditorContext';

const context: VaultEditorContextValue = { allTables: [], idToTitle: {}, pageId: null, registry: { databases: [], tables: [], views: [] }, onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null };
const schema = createEditorSchema(context);

describe('legacy block normalization and typed boundary', () => {
    it('retains ids, unknown extension metadata and legacy heading/list names', () => {
        const input = [{ id: 'keep', type: 'heading2', props: { custom: 'retained' }, content: 'Heading' }, { type: 'bulleted_list_item', content: 'Bullet' }, { type: 'numbered_list_item', content: 'Number' }];
        const blocks = readEditorBlocks(input, schema);
        expect(blocks[0]).toEqual({ id: 'keep', type: 'heading', props: { custom: 'retained', level: 2 }, content: 'Heading' });
        expect(blocks[1]?.type).toBe('bulletListItem'); expect(blocks[2]?.type).toBe('numberedListItem');
        expect(blocks[1]?.id).toBeTruthy(); expect(input[0]?.type).toBe('heading2');
    });
    it('moves old alert content into an editable child without replacing existing children', () => {
        const old = readEditorBlocks([{ type: 'alert', props: { type: 'warning' }, content: [{ type: 'text', text: 'Warning', styles: {} }] }], schema);
        expect(old[0]?.content).toBeUndefined(); expect(old[0]?.children?.[0]?.content).toEqual([{ type: 'text', text: 'Warning', styles: {} }]);
        const nested = readEditorBlocks([{ type: 'alert', props: { type: 'info' }, content: 'obsolete', children: [{ id: 'child', type: 'paragraph', content: 'Keep' }] }], schema);
        expect(nested[0]?.children?.[0]?.id).toBe('child');
    });
    it('removes inline content from legacy containers and normalizes nested blocks', () => {
        const blocks = readEditorBlocks([{ type: 'columnList', content: [], children: [{ type: 'column', content: 'old', children: [{ type: 'heading1', content: 'Nested' }] }] }], schema);
        expect(blocks[0]?.content).toBeUndefined();
        expect(blocks[0]?.children?.[0]?.content).toBeUndefined();
        expect(blocks[0]?.children?.[0]?.children?.[0]?.type).toBe('heading');
    });
    it('accepts native tables with spans, defaults and mixed supported cell representations', () => {
        const table = { type: 'table', content: { type: 'tableContent', columnWidths: [100, undefined], headerRows: 1, rows: [
            { cells: ['First', [{ type: 'text', text: 'Second', styles: { bold: true } }]] },
            { cells: [{ type: 'tableCell', props: { colspan: 2, textAlignment: 'left' }, content: 'Spanned' }] },
        ] } };
        expect(readEditorBlocks([table], schema)[0]?.content).toEqual(table.content);
    });
    it.each([
        [{ type: 'unregistered', content: 'Do not drop' }],
        [{ type: 'heading', props: { level: 'bad' }, content: 'Do not drop' }],
        [{ type: 'paragraph', content: [{ type: 'text', text: 42, styles: {} }] }],
        [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [42] }] } }],
        [{ type: 'paragraph', children: [false] }],
    ])('rejects unsupported input rather than silently discarding data: %j', block => {
        expect(() => readEditorBlocks([block], schema)).toThrow();
    });
    it('roundtrips representative rich Markdown through the runtime schema boundary', async () => {
        const input = '# Heading\n\nA **bold** paragraph with [[Target]] and [@doe].\n\n{{toc}}\n\n```mermaid\ngraph TD; A-->B\n```\n\n![[Note#Section]]\n\n[bookmark: https://example.invalid](https://example.invalid)';
        const parsed = await richMarkdownToBlocks(input);
        const blocks = readEditorBlocks(parsed, schema);
        const markdown = blocksToRichMarkdown(blocks);
        expect(markdown).toContain('[[Target]]'); expect(markdown).toContain('[@doe]'); expect(markdown).toContain('mermaid');
        expect(markdown).toContain('![[Note#Section]]'); expect(markdown).toContain('{{toc}}');
    });
    it('does not alter a non-array during standalone legacy normalization', () => { expect(sanitizeBlocks('legacy')).toBe('legacy'); });
});
