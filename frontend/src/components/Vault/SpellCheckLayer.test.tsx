import { act } from 'react';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SpellCheckLayer from './SpellCheckLayer';
import type { SpellCheckEditorPort } from './spell-check-layer/correctionEditorPort';


const mocks = vi.hoisted(() => ({
    addPersonalWord: vi.fn(),
    createSpellcheckPlugin: vi.fn(() => ({ name: 'spell-plugin' })),
    detectLang: vi.fn(),
    loadSpeller: vi.fn(),
    requestRecompute: vi.fn(),
    spellErrorAt: vi.fn(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));

vi.mock('../../lib/spellcheck/detectLang', () => ({
    detectLang: mocks.detectLang,
}));

vi.mock('../../lib/spellcheck/nspellManager', () => ({
    addPersonalWord: mocks.addPersonalWord,
    loadSpeller: mocks.loadSpeller,
}));

vi.mock('../../lib/spellcheck/spellcheckPlugin', () => ({
    createSpellcheckPlugin: mocks.createSpellcheckPlugin,
    requestRecompute: mocks.requestRecompute,
    spellErrorAt: mocks.spellErrorAt,
    spellPluginKey: { key: 'spell-plugin' },
}));


const views: EditorView[] = [];
const schema = new Schema({ nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', ['span', { class: 'gnosi-spell-error' }, 0]] },
    text: {},
} });


function createEditorFixture() {
    const dom = document.createElement('div');
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('xxholaa')])]) });
    const view = new EditorView(dom, { state });
    views.push(view);
    const transaction = state.tr;
    const insertText = vi.spyOn(transaction, 'insertText');
    vi.spyOn(state, 'tr', 'get').mockReturnValue(transaction);
    vi.spyOn(view, 'posAtDOM').mockReturnValue(4);
    const dispatch = vi.spyOn(view, 'dispatch');
    const registerPlugin = vi.fn();
    const unregisterPlugin = vi.fn();
    const editor = {
        _tiptapEditor: { registerPlugin, unregisterPlugin },
        document: [{ content: [{ text: 'Aquest text té una errada' }] }],
        prosemirrorView: view,
    } satisfies SpellCheckEditorPort;
    return { dispatch, dom, editor, insertText, registerPlugin, unregisterPlugin, transaction };
}


describe('SpellCheckLayer', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        mocks.detectLang.mockResolvedValue('ca');
        mocks.loadSpeller.mockResolvedValue({
            add: vi.fn(),
            correct: vi.fn(() => false),
            suggest: vi.fn(() => ['hola']),
        });
        mocks.spellErrorAt.mockReturnValue({ from: 3, to: 8, word: 'holaa' });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        for (const view of views.splice(0)) view.destroy();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('registers the plugin, detects the language and releases the plugin', async () => {
        const fixture = createEditorFixture();
        const onLangDetected = vi.fn();
        await act(async () => {
            root.render(<SpellCheckLayer editor={fixture.editor} onLangDetected={onLangDetected} />);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(fixture.registerPlugin).toHaveBeenCalledOnce();
        expect(mocks.detectLang).toHaveBeenCalledWith('Aquest text té una errada');
        expect(onLangDetected).toHaveBeenCalledWith('ca');
        expect(mocks.loadSpeller).toHaveBeenCalledWith('ca');

        act(() => {
            root.unmount();
        });
        expect(fixture.unregisterPlugin).toHaveBeenCalledOnce();
        root = createRoot(container);
    });

    it('opens a suggestion and replaces the misspelled range', async () => {
        const fixture = createEditorFixture();
        await act(async () => {
            root.render(<SpellCheckLayer editor={fixture.editor} forcedLang="ca" />);
            await Promise.resolve();
            await Promise.resolve();
        });
        const misspelled = fixture.dom.querySelector('.gnosi-spell-error');
        if (!misspelled) throw new Error('Missing spell error fixture');
        act(() => {
            misspelled.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        const suggestion = Array.from(document.body.querySelectorAll('button'))
            .find((button) => button.textContent === 'hola');
        if (!suggestion) throw new Error('Suggestion menu did not open');
        act(() => {
            suggestion.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });

        expect(fixture.insertText).toHaveBeenCalledWith('hola', 3, 8);
        expect(fixture.dispatch).toHaveBeenCalledWith(fixture.transaction);
        expect(fixture.editor.prosemirrorView.state.doc.textContent).toBe('xxhola');
        expect(document.body.querySelector('[data-gnosi-portal="spell-menu"]')).toBeNull();
    });

    it('adds a word to the personal dictionary', async () => {
        const fixture = createEditorFixture();
        await act(async () => {
            root.render(<SpellCheckLayer editor={fixture.editor} forcedLang="ca" />);
            await Promise.resolve();
            await Promise.resolve();
        });
        act(() => {
            fixture.dom.querySelector('.gnosi-spell-error')?.dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true }),
            );
        });
        const addButton = Array.from(document.body.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Add to dictionary'));
        if (!addButton) throw new Error('Add-to-dictionary action did not render');
        act(() => {
            addButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });

        expect(mocks.addPersonalWord).toHaveBeenCalledWith('holaa');
    });
});
