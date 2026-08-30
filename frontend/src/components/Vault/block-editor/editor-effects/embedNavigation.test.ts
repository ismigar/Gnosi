import { afterEach, describe, expect, it, vi } from 'vitest';
import { adjacentBlocks, currentBlockId, enterEmbed, exitEmbed, focusFirstBlock } from './embedNavigation';
import { handleBodyKeyboard } from './bodyKeyboard';
import { editorFixture, paragraph, embed } from './testFixtures';
import type { EmbedNavApi } from './types';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture(...args: Parameters<typeof editorFixture>) { const result = editorFixture(...args); cleanups.push(result.destroy); return result; }
function key(value: string, options: KeyboardEventInit = {}) { return new KeyboardEvent('keydown', { key: value, cancelable: true, ...options }); }

describe('embed navigation and focus', () => {
    it('uses sibling adjacency for root and nested blocks, parent for first child', () => {
        const child = paragraph('child'); const second = embed('nested'); const parent = paragraph('parent', [child, second]);
        const last = paragraph('last'); const document = [parent, last];
        expect(adjacentBlocks('parent', document)).toEqual({ prevBlock: null, nextBlock: last });
        expect(adjacentBlocks('child', document)).toEqual({ prevBlock: parent, nextBlock: second });
        expect(adjacentBlocks('nested', document)).toEqual({ prevBlock: child, nextBlock: null });
        expect(adjacentBlocks('missing', document)).toEqual({ prevBlock: null, nextBlock: null });
    });
    it('falls back from a failing text cursor to a block selection', () => {
        const { editor } = fixture();
        editor.getTextCursorPosition.mockImplementation(() => { throw new Error('Node selection'); });
        editor.getSelection.mockReturnValue({ blocks: [embed('selected')] });
        expect(currentBlockId(editor)).toBe('selected');
        editor.getSelection.mockImplementation(() => { throw new Error('Disposing'); });
        expect(currentBlockId(editor)).toBeNull();
    });
    it('focuses first embed API unless explicitly false, then falls back to text start', () => {
        const { editor } = fixture([embed('view')]);
        const api = { focusFirstCell: vi.fn<() => unknown>(() => undefined) };
        expect(focusFirstBlock(editor, new Map([['view', api]]))).toBe(true);
        expect(editor.focus).not.toHaveBeenCalled();
        api.focusFirstCell.mockReturnValue(false);
        expect(focusFirstBlock(editor, new Map([['view', api]]))).toBe(true);
        expect(editor.setTextCursorPosition).toHaveBeenCalledWith('view', 'start');
        editor.document = [];
        expect(focusFirstBlock(editor, new Map())).toBe(false);
    });
    it('preserves detached keyboard entry semantics and explicit false', () => {
        const receiver = vi.fn<(value: unknown) => void>();
        const api: EmbedNavApi = { focusFirstCell: function () { receiver(this); return undefined; }, focusLastCell: () => false };
        const navigation = new Map([['view', api]]);
        expect(enterEmbed(navigation, 'view', 'first')).toBe(true);
        expect(receiver).toHaveBeenCalledExactlyOnceWith(undefined);
        expect(enterEmbed(navigation, 'view', 'last')).toBe(false);
        expect(enterEmbed(navigation, 'missing', 'first')).toBe(false);
    });
    it('exits through adjacent embeds, regular blocks, or title without adding a paragraph', () => {
        const { editor } = fixture([embed('a'), embed('b'), paragraph('c')]);
        const last = vi.fn(() => true); const up = vi.fn();
        const navigation = new Map([['a', { focusLastCell: last }]]);
        exitEmbed(editor, navigation, 'b', 'up', up);
        expect(last).toHaveBeenCalledOnce();
        expect(editor.focus).not.toHaveBeenCalled();
        exitEmbed(editor, navigation, 'a', 'up', up);
        expect(up).toHaveBeenCalledOnce();
        exitEmbed(editor, navigation, 'b', 'down');
        expect(editor.setTextCursorPosition).toHaveBeenCalledWith('c', 'start');
        expect(editor.insertBlocks).not.toHaveBeenCalled();
    });
    it('appends a paragraph only after the last embed and reads the updated document', () => {
        const last = embed('last'); const { editor } = fixture([last]);
        editor.insertBlocks.mockImplementation(() => { editor.document.push(paragraph('new')); return []; });
        exitEmbed(editor, new Map(), 'last', 'down');
        expect(editor.insertBlocks).toHaveBeenCalledExactlyOnceWith([{ type: 'paragraph' }], 'last', 'after');
        expect(editor.setTextCursorPosition).toHaveBeenCalledWith('new', 'start');
        exitEmbed(editor, new Map(), 'missing', 'down');
        expect(editor.insertBlocks).toHaveBeenCalledOnce();
    });
});

describe('body capture keyboard', () => {
    it('preserves first/last visual-line checks and explicit embed rejection', () => {
        const { editor, view } = fixture([paragraph('text'), embed('view')]); view.dom.focus();
        const first = vi.fn<() => unknown>(() => undefined); const edge = vi.fn(() => false);
        const navigation = new Map([['view', { focusFirstCell: first }]]);
        const blocked = key('ArrowDown'); handleBodyKeyboard(blocked, { editor, navigation, caretAtEdge: edge });
        expect(blocked.defaultPrevented).toBe(false); expect(first).not.toHaveBeenCalled();
        edge.mockReturnValue(true);
        const allowed = key('ArrowDown'); handleBodyKeyboard(allowed, { editor, navigation, caretAtEdge: edge });
        expect(allowed.defaultPrevented).toBe(true); expect(edge).toHaveBeenCalledWith('last');
        first.mockReturnValue(false);
        const rejected = key('ArrowDown'); handleBodyKeyboard(rejected, { editor, navigation, caretAtEdge: edge });
        expect(rejected.defaultPrevented).toBe(false);
    });
    it('moves up to title, supports alt-up properties, ignores other modifiers', () => {
        const { editor, view } = fixture(); view.dom.focus();
        const up = vi.fn(); const properties = vi.fn();
        const inputs = { editor, navigation: new Map(), caretAtEdge: () => true, onNavigateUp: up, onOpenProperties: properties };
        const event = key('ArrowUp'); handleBodyKeyboard(event, inputs);
        expect(event.defaultPrevented).toBe(true); expect(up).toHaveBeenCalledOnce();
        handleBodyKeyboard(key('ArrowUp', { altKey: true }), inputs); expect(properties).toHaveBeenCalledOnce();
        for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) handleBodyKeyboard(key('ArrowUp', modifier), inputs);
        expect(up).toHaveBeenCalledOnce();
    });
    it('does not intercept a focused embed shell, and consumes Enter/Space on its block', () => {
        const { editor, wrapper, view } = fixture([embed('view')]);
        const shell = document.createElement('div'); shell.tabIndex = -1; wrapper.appendChild(shell); shell.focus();
        const first = vi.fn(); const inputs = { editor, navigation: new Map([['view', { focusFirstCell: first }]]) };
        const event = key('Enter'); handleBodyKeyboard(event, inputs); expect(event.defaultPrevented).toBe(false);
        view.dom.focus();
        for (const value of ['Enter', ' ']) { const event = key(value); handleBodyKeyboard(event, inputs); expect(event.defaultPrevented).toBe(true); }
        expect(first).toHaveBeenCalledTimes(2);
    });
});
