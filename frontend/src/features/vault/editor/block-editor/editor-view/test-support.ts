import { createRef } from 'react';
import { BlockNoteEditor } from '@blocknote/core';
import { createInstance } from 'i18next';
import { afterEach, vi } from 'vitest';
import { createEditorSchema } from '../schema';
import type { GnosiEditor } from '../schema';
import type { VaultEditorContextValue } from '../../../../../shared/editor/VaultEditorContext';
import type { EditorViewProps, EditorMenuItem } from './types';

const translator = createInstance();
export const translationsReady = translator.init({ lng: 'en', fallbackLng: 'en', showSupportNotice: false, resources: { en: { translation: {} } } });
const editors = new Set<GnosiEditor>();
afterEach(() => { for (const editor of editors) editor._tiptapEditor.destroy(); editors.clear(); });

export const testContext: VaultEditorContextValue = {
    allTables: [], idToTitle: {}, pageId: 'fixture', registry: { databases: [], tables: [], views: [] },
    onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null,
};

export function viewInputs() {
    const editor = BlockNoteEditor.create({ schema: createEditorSchema(testContext),
        initialContent: [{ id: 'fixture-anchor', type: 'paragraph', content: 'Body' }],
    });
    editors.add(editor);
    const block = editor.document[0];
    if (!block) throw new Error('Missing editor fixture block');
    vi.spyOn(editor, 'getTextCursorPosition').mockImplementation(() => ({ block, prevBlock: undefined, nextBlock: undefined, parentBlock: undefined }));
    vi.spyOn(editor, 'focus').mockImplementation(() => undefined);
    vi.spyOn(editor, 'setTextCursorPosition').mockImplementation(() => undefined);
    const inputs = {
        editor, t: translator.t, allTables: [], normalizedLinkableNotes: [],
        openInlineIconPicker: vi.fn(), capturePageViewAnchor: vi.fn(), onOpenPageViewModal: vi.fn(),
        requestInsertContent: vi.fn<EditorViewProps['requestInsertContent']>().mockResolvedValue({}),
        applyInsertResult: vi.fn(), insertWikiLink: vi.fn(), setIsCitePickerOpen: vi.fn(), openAICommand: vi.fn(), setLinkCardCtx: vi.fn(),
        normalizePendingLinkTitle: (value: string) => (value.replace(/^\[\[/, '').split('|')[0] ?? '').trim(),
        formatNoteDisambiguator: (value: string) => value,
        createMissingPageAndInsertLink: vi.fn<EditorViewProps['createMissingPageAndInsertLink']>(),
        getNoteHeadings: vi.fn<EditorViewProps['getNoteHeadings']>().mockResolvedValue([]), insertTransclusion: vi.fn(),
        loadContacts: vi.fn<EditorViewProps['loadContacts']>().mockResolvedValue([]),
        inlineIconPickerAnchor: null, closeInlineIconPicker: vi.fn(), insertInlineIcon: vi.fn(),
        pendingInsert: null, getPendingInsert: vi.fn<EditorViewProps['getPendingInsert']>().mockReturnValue(null), setPendingInsert: vi.fn(),
        tableId: 'books', isCitePickerOpen: false, insertCitation: vi.fn(), aiRequest: null, setAiRequest: vi.fn(),
        insertGeneratedMarkdown: vi.fn(), linkCardCtx: null, doLinkCard: vi.fn(), linkPasteCtx: null,
        applyContextualLinkPaste: vi.fn(), closeContextualLinkPaste: vi.fn(),
        providerValue: testContext, editorWrapperRef: createRef<HTMLDivElement>(), isEditable: true,
        effectiveTheme: 'light', spellEnabled: false, noteFilename: 'fixture', onLangDetected: vi.fn(), spellLang: 'ca',
        detectEmbeddableUrl: vi.fn<EditorViewProps['detectEmbeddableUrl']>().mockReturnValue(null),
    } satisfies EditorViewProps;
    return inputs;
}

export function menuItem(items: readonly EditorMenuItem[], title: string): EditorMenuItem {
    const item = items.find(entry => entry.title === title);
    if (!item) throw new Error(`Missing menu item ${title}`);
    return item;
}
