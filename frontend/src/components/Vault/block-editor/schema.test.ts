import { describe, expect, it } from 'vitest';
import { createEditorSchema } from './schema';
import { footnoteDocument } from './footnoteDocument';
import type { VaultEditorContextValue } from '../VaultEditorContext';

const context: VaultEditorContextValue = {
    allTables: [], idToTitle: {}, pageId: null, registry: { databases: [], tables: [], views: [] },
    onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null,
};

describe('editor schema compatibility', () => {
    it('keeps all custom block types and native columns/toggles', () => {
        const schema = createEditorSchema(context);
        for (const type of ['database', 'gnosi_view', 'transclusion', 'embed', 'bibliography', 'alert', 'tableOfContents', 'mermaid', 'linkcard', 'synced', 'column', 'columnList', 'toggleListItem']) {
            expect(Object.keys(schema.blockSchema)).toContain(type);
        }
        expect(schema.blockSchema.gnosi_view.propSchema).toEqual({ view_id: { default: '' }, heading: { default: '' }, heading_level: { default: '1' }, section: { default: '' } });
        expect(schema.blockSchema.alert.content).toBe('none');
        expect(schema.blockSchema.alert.propSchema.type.values).toEqual(['info', 'warning', 'error', 'success']);
    });
    it('keeps all inline formats and their original persisted properties', () => {
        const schema = createEditorSchema(context);
        expect(Object.keys(schema.inlineContentSchema).sort()).toEqual(['cite', 'dateref', 'footnote', 'inlineIcon', 'link', 'mention', 'text', 'wikilink']);
        expect(schema.inlineContentSchema.wikilink.propSchema).toEqual({ title: { default: '' }, target: { default: '' } });
        expect(schema.inlineContentSchema.footnote.propSchema).toEqual({ id: { default: '' }, content: { default: '' } });
    });
    it('projects footnote numbering through nested blocks without changing document data', () => {
        const document = [{ type: 'paragraph', content: [{ type: 'footnote', props: { id: 'first', content: 'Text' } }] },
            { type: 'table', content: { rows: [] } }, { type: 'column', children: [
                { type: 'paragraph', content: [{ type: 'footnote', props: { id: 'second' } }] },
            ] }];
        const before = JSON.stringify(document);
        expect(footnoteDocument(document)).toEqual([
            { content: [{ type: 'footnote', props: { id: 'first' } }], children: [] },
            { content: [], children: [] },
            { content: [], children: [{ content: [{ type: 'footnote', props: { id: 'second' } }], children: [] }] },
        ]);
        expect(JSON.stringify(document)).toBe(before);
        expect(footnoteDocument(null)).toEqual([]);
    });
});
