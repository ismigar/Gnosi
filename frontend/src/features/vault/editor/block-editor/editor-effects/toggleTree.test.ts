import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeSelection } from '@tiptap/pm/state';
import { containsBlockId, findSiblings, nestIntoToggle, withHeadingSection } from './toggleTree';
import { findToggleDropTarget, getDraggedBlockIds, createToggleDrop } from './toggleDrop';
import { editorFixture, heading, paragraph, pmSchema } from './testFixtures';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture(...args: Parameters<typeof editorFixture>) { const fixture = editorFixture(...args); cleanups.push(fixture.destroy); return fixture; }

describe('toggle sections and transactions', () => {
    it('takes the full heading section, including deeper headings but not peers', () => {
        const first = heading('heading', 2);
        const nested = paragraph('nested');
        const body = paragraph('body', [nested]);
        const document = [first, body, heading('sub', 3), paragraph('sub-body'), heading('peer', 2), paragraph('outside')];
        expect(withHeadingSection([first], document).map((block) => block.id)).toEqual(['heading', 'body', 'sub', 'sub-body']);
        expect(findSiblings('nested', document)).toEqual([nested]);
        expect(containsBlockId(body, 'nested')).toBe(true);
        expect(findSiblings('missing', document)).toBeNull();
    });
    it('leaves multi-selections and non-headings unchanged, including missing object identity', () => {
        const first = heading('h'); const body = paragraph('p');
        const selected = [first, body];
        expect(withHeadingSection(selected, selected)).toBe(selected);
        expect(withHeadingSection([body], selected)).toEqual([body]);
        expect(withHeadingSection([heading('h')], selected)).toHaveLength(1);
    });
    it('moves before an existing child as exactly one transaction preserving IDs', () => {
        const selected = heading('h'); const body = paragraph('body'); const existing = paragraph('existing');
        const { editor, transactions } = fixture([selected, body, heading('target', 1, [existing])]);
        expect(nestIntoToggle(editor, 'target', ['h'])).toBe(true);
        expect(transactions).toHaveBeenCalledOnce();
        expect(editor.removeBlocks).toHaveBeenCalledExactlyOnceWith(['h', 'body']);
        expect(editor.insertBlocks).toHaveBeenCalledExactlyOnceWith([selected, body], 'existing', 'before');
        expect(editor.updateBlock).not.toHaveBeenCalled();
        expect(editor.removeBlocks.mock.invocationCallOrder[0]).toBeLessThan(editor.insertBlocks.mock.invocationCallOrder[0] ?? -1);
    });
    it('adds children to an empty toggle and refuses self/descendant/unknown drops', () => {
        const child = paragraph('child'); const source = paragraph('source', [child]); const target = heading('target');
        const { editor } = fixture([source, target]);
        expect(nestIntoToggle(editor, 'source', ['source'])).toBe(false);
        expect(nestIntoToggle(editor, 'child', ['source'])).toBe(false);
        expect(nestIntoToggle(editor, 'missing', ['source'])).toBe(false);
        expect(nestIntoToggle(editor, 'target', ['external'])).toBe(false);
        expect(nestIntoToggle(editor, 'target', ['source'])).toBe(true);
        expect(editor.updateBlock).toHaveBeenCalledExactlyOnceWith('target', { children: [source] });
    });
});

function dropDom() {
    const { wrapper, editor, view } = fixture([paragraph('source'), heading('target')]);
    const outer = document.createElement('div'); outer.className = 'bn-block-outer'; outer.dataset.id = 'target';
    outer.innerHTML = '<div class="bn-block"><div class="bn-block-content"><div><div class="bn-toggle-wrapper">Toggle</div></div></div></div>';
    wrapper.appendChild(outer);
    const header = outer.querySelector('.bn-toggle-wrapper');
    if (!header) throw new Error('Missing toggle header');
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 500, 48));
    return { wrapper, editor, view, outer, header };
}
describe('drop targeting and feedback', () => {
    it('accepts the full row, preserves fixed edge bands, ignores children/outside', () => {
        const { wrapper, outer } = dropDom();
        const root = { elementsFromPoint: () => [outer] };
        expect(findToggleDropTarget(wrapper, root, 450, 108)).toBe('target');
        expect(findToggleDropTarget(wrapper, root, 450, 140)).toBe('target');
        for (const y of [99, 100, 107, 141, 148, 160]) expect(findToggleDropTarget(wrapper, root, 450, y)).toBeNull();
        expect(findToggleDropTarget(wrapper, { elementsFromPoint: () => [document.body] }, 1, 120)).toBeNull();
    });
    it('accepts the empty-toggle placeholder without an edge band', () => {
        const { wrapper, outer } = dropDom();
        const button = document.createElement('button'); button.className = 'bn-toggle-add-block-button'; outer.appendChild(button);
        expect(findToggleDropTarget(wrapper, { elementsFromPoint: () => [button] }, 0, 200)).toBe('target');
    });
    it('gets actual selected block ids from PM, excludes outside ids, and resets highlight', () => {
        const { wrapper, editor, view, outer } = dropDom();
        const node = pmSchema.node('paragraph', { id: 'source' });
        view.updateState(view.state.apply(view.state.tr.replaceWith(0, view.state.doc.content.size, node)));
        view.updateState(view.state.apply(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
        expect(getDraggedBlockIds(view, editor)).toEqual(['source']);
        editor.getBlock.mockReturnValue(undefined);
        expect(getDraggedBlockIds(view, editor)).toEqual([]);
        const previous = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
        cleanups.push(() => {
            if (previous) Object.defineProperty(document, 'elementsFromPoint', previous);
            else Reflect.deleteProperty(document, 'elementsFromPoint');
            vi.unstubAllGlobals();
        });
        Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [outer] });
        vi.stubGlobal('CSS', { escape: (value: string) => value });
        const drop = createToggleDrop(editor, wrapper);
        const event = new MouseEvent('dragover', { clientX: 400, clientY: 120 });
        // MouseEvent and DragEvent share coordinates; use the real declared shape.
        const drag = Object.assign(event, { dataTransfer: null });
        drop.onDragOver(drag);
        expect(outer.classList.contains('gnosi-toggle-drop-target')).toBe(true);
        expect(document.body.classList.contains('gnosi-toggle-nesting')).toBe(true);
        drop.reset();
        expect(outer.classList.contains('gnosi-toggle-drop-target')).toBe(false);
        expect(document.body.classList.contains('gnosi-toggle-nesting')).toBe(false);
    });
    it('handles an actual moved PM selection once and rejects copies, files and failed moves', () => {
        const { wrapper, editor, view, outer } = dropDom();
        const node = pmSchema.node('paragraph', { id: 'source' });
        view.updateState(view.state.apply(view.state.tr.replaceWith(0, view.state.doc.content.size, node)));
        view.updateState(view.state.apply(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
        const previous = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
        Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [outer] });
        cleanups.push(() => { if (previous) Object.defineProperty(document, 'elementsFromPoint', previous); else Reflect.deleteProperty(document, 'elementsFromPoint'); });
        const drop = createToggleDrop(editor, wrapper);
        const event = Object.assign(new MouseEvent('drop', { clientX: 200, clientY: 120 }), { dataTransfer: null });
        const slice = view.state.selection.content();
        expect(drop.handleDrop(view, event, slice, false)).toBe(false);
        Object.defineProperty(event, 'dataTransfer', { configurable: true, value: { files: [new File(['pdf'], 'document.pdf')] } });
        expect(drop.handleDrop(view, event, slice, true)).toBe(false);
        Object.defineProperty(event, 'dataTransfer', { configurable: true, value: null });
        expect(drop.handleDrop(view, event, slice, true)).toBe(true);
        expect(editor.removeBlocks).toHaveBeenCalledExactlyOnceWith(['source']);
        expect(editor.updateBlock).toHaveBeenCalledWith('target', { children: [editor.document[0]] });
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        editor.removeBlocks.mockImplementation(() => { throw new Error('Cannot move'); });
        expect(drop.handleDrop(view, event, slice, true)).toBe(false);
        expect(error).toHaveBeenCalledWith('drop into toggle failed', expect.any(Error));
    });
});
