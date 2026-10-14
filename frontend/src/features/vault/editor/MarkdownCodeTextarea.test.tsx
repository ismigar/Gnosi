import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
/** @vitest-environment jsdom */
import { act } from 'react';
import { EditorSelection } from '@codemirror/state';
import { undo } from '@codemirror/commands';
import { getCM, Vim, type CodeMirrorV } from '@replit/codemirror-vim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { markdownView, mockCodeMirrorLayout } from '../../../../tests/helpers/codemirror';
import { MarkdownCodeTextarea } from './MarkdownCodeTextarea';
import { getPluginEditorSelection, replacePluginEditorSelection } from '../../../shared/plugins/editor-bridge';
import { resetApiTestStorage, writeApiTestStorage } from '../../../../tests/api-request';

mockCodeMirrorLayout();
afterEach(() => { resetApiTestStorage(); });
const defaults = { onChange: vi.fn(), onSave: vi.fn(), ariaLabel: 'Markdown source' };

function hasVimState(cm: NonNullable<ReturnType<typeof getCM>>): cm is NonNullable<ReturnType<typeof getCM>> & CodeMirrorV {
    return cm.state.vim != null;
}

describe('Markdown source surface', () => {
    it('does not rebind a mounted source editor to a different account when reactivated', () => {
        writeApiTestStorage('gnosi_user_id', 'first-account');
        writeApiTestStorage('gnosi_active_vault', 'same-vault');
        const mounted = mountTestComponent(<MarkdownCodeTextarea {...defaults} value="Private text" documentId="note" />);
        const first = getPluginEditorSelection();
        act(() => {
            writeApiTestStorage('gnosi_user_id', 'next-account');
            dispatchWindowEvent(new StorageEvent('storage', { key: 'gnosi_user_id' }));
        });
        expect(() => replacePluginEditorSelection('wrong account', first)).toThrow('No active');
        mounted.render(<MarkdownCodeTextarea {...defaults} value="Private text" documentId="note" isActive={false} />);
        mounted.render(<MarkdownCodeTextarea {...defaults} value="Private text" documentId="note" />);
        expect(() => getPluginEditorSelection()).toThrow('No active');
        expect(markdownView(mounted.container).state.doc.toString()).toBe('Private text');
    });
    it('exposes a guarded selection bridge that invalidates edits on cursor, document and page changes', () => {
        const onChange = vi.fn();
        const mounted = mountTestComponent(<MarkdownCodeTextarea {...defaults} onChange={onChange} value="One two" documentId="first" />);
        const view = markdownView(mounted.container);
        act(() => { view.dispatch({ selection: { anchor: 0, head: 3 } }); });
        const first = getPluginEditorSelection();
        expect(first.ranges).toEqual([{ from: 0, to: 3, text: 'One' }]);
        act(() => { view.dispatch({ selection: { anchor: 4, head: 7 } }); });
        expect(() => replacePluginEditorSelection('Changed', first)).toThrow('selection changed');
        const second = getPluginEditorSelection();
        act(() => { replacePluginEditorSelection('three', second); });
        expect(onChange).toHaveBeenLastCalledWith('One three');
        expect(() => replacePluginEditorSelection('Replay', second)).toThrow('selection changed');
        const third = getPluginEditorSelection();
        mounted.render(<MarkdownCodeTextarea {...defaults} value="Other" documentId="second" />);
        expect(() => replacePluginEditorSelection('Wrong page', third)).toThrow('selection changed');
        mounted.render(<MarkdownCodeTextarea {...defaults} value="Other" documentId="second" readOnly />);
        expect(() => replacePluginEditorSelection('Locked', getPluginEditorSelection())).toThrow('read-only');
        mounted.render(<MarkdownCodeTextarea {...defaults} value="Other" documentId="second" isActive={false} />);
        expect(() => getPluginEditorSelection()).toThrow('No active');
    });
    it('keeps an empty document visible, labelled and focusable', () => {
        const mounted = mountTestComponent(<MarkdownCodeTextarea {...defaults} value="" placeholder="Write Markdown…" />);
        const view = markdownView(mounted.container);
        expect(view.contentDOM.getAttribute('aria-label')).toBe('Markdown source');
        expect(view.dom.textContent).toContain('Write Markdown…');
        expect(getComputedStyle(view.dom).minHeight).toBe('500px');
        act(() => { view.focus(); });
        expect(document.activeElement).toBe(view.contentDOM);
    });

    it('highlights Markdown and edits several selections as one undoable change', () => {
        const onChange = vi.fn();
        const mounted = mountTestComponent(<MarkdownCodeTextarea {...defaults} onChange={onChange} value={'# Heading\n\none two one'} />);
        const view = markdownView(mounted.container);
        expect(view.contentDOM.querySelector('.cm-line span')?.className).toBeTruthy();
        act(() => {
            view.dispatch({ selection: EditorSelection.create([EditorSelection.range(11, 14), EditorSelection.range(19, 22)]) });
            view.dispatch(view.state.replaceSelection('new'));
        });
        expect(view.state.doc.toString()).toBe('# Heading\n\nnew two new');
        expect(onChange).toHaveBeenLastCalledWith('# Heading\n\nnew two new');
        act(() => { undo(view); });
        expect(view.state.doc.toString()).toBe('# Heading\n\none two one');
    });

    it('keeps focus and maps the selection across external changes without resaving them', () => {
        const onChange = vi.fn();
        const mounted = mountTestComponent(<MarkdownCodeTextarea {...defaults} onChange={onChange} value="Start. End." />);
        const view = markdownView(mounted.container);
        act(() => { view.dispatch({ selection: { anchor: 10 } }); view.focus(); });
        mounted.render(<MarkdownCodeTextarea {...defaults} onChange={onChange} value="New Start. End." />);
        expect(markdownView(mounted.container)).toBe(view);
        expect(view.state.selection.main.head).toBe(14);
        expect(document.activeElement).toBe(view.contentDOM);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('reconfigures Vim without resetting text/history and saves through :write', () => {
        const save = vi.fn();
        const mounted = mountTestComponent(<MarkdownCodeTextarea {...defaults} onSave={save} value="Word" />);
        const view = markdownView(mounted.container);
        mounted.render(<MarkdownCodeTextarea {...defaults} onSave={save} value="Word" vimMode />);
        const cm = getCM(view);
        if (!cm) throw new Error('Vim adapter missing');
        act(() => {
            Vim.handleKey(cm, 'l', 'user');
            if (!hasVimState(cm)) throw new Error('Vim state was not initialized');
            Vim.handleEx(cm, 'write');
        });
        expect(view.state.selection.main.head).toBe(1);
        expect(save).toHaveBeenCalledOnce();
        expect(view.state.doc.toString()).toBe('Word');
        mounted.render(<MarkdownCodeTextarea {...defaults} onSave={save} value="Word" />);
        expect(markdownView(mounted.container)).toBe(view);
        expect(getCM(view)).toBeNull();
    });

    it('removes editing access when the page becomes locked', () => {
        const mounted = mountTestComponent(<MarkdownCodeTextarea {...defaults} value="Word" />);
        const view = markdownView(mounted.container);
        mounted.render(<MarkdownCodeTextarea {...defaults} value="Word" readOnly />);
        expect(view.contentDOM.getAttribute('contenteditable')).toBe('false');
        expect(view.state.readOnly).toBe(true);
    });
});
