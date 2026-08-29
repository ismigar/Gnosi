import { act } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SpellCheckLayer from './SpellCheckLayer';


const mocks = vi.hoisted(() => ({
    addPersonalWord: vi.fn(),
    createSpellcheckPlugin: vi.fn(() => ({ name: 'spell-plugin' })),
    detectLang: vi.fn(),
    loadSpeller: vi.fn(),
    requestRecompute: vi.fn(),
    spellErrorAt: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


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


interface EditorFixture {
    readonly dispatch: ReturnType<typeof vi.fn>;
    readonly dom: HTMLDivElement;
    readonly editor: BlockNoteEditor;
    readonly insertText: ReturnType<typeof vi.fn>;
    readonly registerPlugin: ReturnType<typeof vi.fn>;
    readonly unregisterPlugin: ReturnType<typeof vi.fn>;
}


function createEditorFixture(): EditorFixture {
    const dom = document.createElement('div');
    const misspelled = document.createElement('span');
    misspelled.className = 'gnosi-spell-error';
    misspelled.textContent = 'holaa';
    dom.append(misspelled);
    const insertText = vi.fn(() => ({ transaction: true }));
    const dispatch = vi.fn();
    const registerPlugin = vi.fn();
    const unregisterPlugin = vi.fn();
    const view = {
        dispatch,
        dom,
        focus: vi.fn(),
        posAtDOM: vi.fn(() => 4),
        state: { tr: { insertText } },
    };
    const editor = {
        _tiptapEditor: { registerPlugin, unregisterPlugin },
        document: [{ content: [{ text: 'Aquest text té una errada' }] }],
        prosemirrorView: view,
    } as unknown as BlockNoteEditor;
    return { dispatch, dom, editor, insertText, registerPlugin, unregisterPlugin };
}


describe('SpellCheckLayer', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
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
        vi.clearAllMocks();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
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
        expect(fixture.dispatch).toHaveBeenCalledWith({ transaction: true });
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
