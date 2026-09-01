import type { ReactNode } from 'react';
import { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../../tests/mount-react';
import type { EditorMenuItem } from './types';
import { EditorView } from './EditorView';
import { translationsReady, viewInputs } from './test-support';

const observed = vi.hoisted(() => {
    const result: { editor: unknown; editable: boolean | undefined; theme: unknown;
        spell: unknown; correction: unknown; menus: Map<string, (query: string) => Promise<EditorMenuItem[]>> } = {
        editor: null, editable: undefined, theme: null, spell: null, correction: null, menus: new Map(),
    };
    return result;
});
// Vitest's default CSS transform returns an empty module, even for ?raw.
// Load the actual owned asset for this fixture without changing production CSS.
vi.mock('./editor.css?raw', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const cssPath = fileURLToPath(import.meta.url).replace(/EditorView\.test\.tsx$/, 'editor.css');
    return { default: await readFile(cssPath, 'utf8') };
});
vi.mock('@blocknote/mantine', () => ({ BlockNoteView: ({ children, editor, editable, theme }: {
    children: ReactNode; editor: unknown; editable?: boolean; theme?: unknown;
}) => {
    observed.editor = editor; observed.editable = editable; observed.theme = theme;
    return <div data-blocknote-view>{children}</div>;
} }));
vi.mock('@blocknote/react', async importOriginal => {
    const original = await importOriginal<typeof import('@blocknote/react')>();
    return { ...original,
        SideMenuController: () => <div data-side-menu />,
        SuggestionMenuController: ({ triggerCharacter, getItems }: {
            triggerCharacter: string; getItems: (query: string) => Promise<EditorMenuItem[]>;
        }) => { observed.menus.set(triggerCharacter, getItems); return <div data-suggestions={triggerCharacter} />; },
    };
});
vi.mock('../../SpellCheckLayer', () => ({ default: (props: unknown) => { observed.spell = props; return <div data-spell />; } }));
vi.mock('../../AICorrectLayer', () => ({ default: (props: unknown) => { observed.correction = props; return <div data-correction />; } }));
vi.mock('./EditorModals', () => ({ EditorModals: () => <div data-modals /> }));
beforeAll(async () => { await translationsReady; });

describe('editor view composition', () => {
    it('keeps inline stylesheet order, the exact editor, four menu triggers and post-editor layers', () => {
        const inputs = viewInputs();
        const { container } = mountTestComponent(<EditorView {...inputs} />);
        expect(container.firstElementChild?.tagName).toBe('STYLE');
        expect(container.querySelector('style')?.textContent).toContain('margin-bottom: 26.5px !important;');
        expect(container.querySelector('style')?.textContent).toContain('body.gnosi-toggle-nesting');
        expect([...container.querySelectorAll('[data-suggestions]')].map(node => node.getAttribute('data-suggestions'))).toEqual(['/', '[', '!', '@']);
        expect(observed.editor).toBe(inputs.editor); expect(observed.editable).toBe(true); expect(observed.theme).toBe('light');
        expect(observed.spell).toEqual({ editor: inputs.editor, enabled: false, pageId: 'fixture', onLangDetected: inputs.onLangDetected });
        expect(observed.correction).toEqual({ editor: inputs.editor, lang: 'ca' });
        expect([...container.children].slice(-3).map(node => node.getAttributeNames()[0])).toEqual(['data-spell', 'data-correction', 'data-modals']);
        expect(inputs.editorWrapperRef.current?.querySelector('[data-blocknote-view]')).not.toBeNull();
    });

    it('allows file drops through dragover but does not intercept non-file drags', () => {
        const inputs = viewInputs();
        mountTestComponent(<EditorView {...inputs} />);
        const fileDrag = new Event('dragover', { bubbles: true, cancelable: true });
        Object.defineProperty(fileDrag, 'dataTransfer', { value: { types: ['Files'] } });
        act(() => { inputs.editorWrapperRef.current?.dispatchEvent(fileDrag); });
        expect(fileDrag.defaultPrevented).toBe(true);
        const textDrag = new Event('dragover', { bubbles: true, cancelable: true });
        Object.defineProperty(textDrag, 'dataTransfer', { value: { types: ['text/plain'] } });
        act(() => { inputs.editorWrapperRef.current?.dispatchEvent(textDrag); });
        expect(textDrag.defaultPrevented).toBe(false);
    });
});
