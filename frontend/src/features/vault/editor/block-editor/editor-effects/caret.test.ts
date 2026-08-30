import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { caretOnBlockEdge } from './caret';
import { belongsToAreas } from './useAreaHeadings';
import type { GnosiEditor } from '../schema';
import type { EffectsEditor } from './types';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); window.getSelection()?.removeAllRanges(); });

function select(text: string, caretTop: number, caretHeight: number) {
    const block = document.createElement('div'); block.className = 'bn-block-content';
    const node = document.createTextNode(text); block.appendChild(node); document.body.appendChild(block);
    cleanups.push(() => { block.remove(); });
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 80));
    const original = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [new DOMRect(0, caretTop, 1, caretHeight)] });
    cleanups.push(() => { if (original) Object.defineProperty(Range.prototype, 'getClientRects', original); else Reflect.deleteProperty(Range.prototype, 'getClientRects'); });
    const range = document.createRange(); range.setStart(node, 0); range.collapse(true);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    return block;
}

describe('visual caret edges', () => {
    it('compares against the current block, with the original line-height tolerance', () => {
        select('body', 105, 20);
        expect(caretOnBlockEdge('first')).toBe(true);
        expect(caretOnBlockEdge('last')).toBe(false);
    });
    it('enters the following view only from the final visual line', () => {
        select('body', 160, 20);
        expect(caretOnBlockEdge('first')).toBe(false);
        expect(caretOnBlockEdge('last')).toBe(true);
    });
    it('regards an empty block as both edges but rejects selection outside a block', () => {
        const block = select('', 130, 0);
        expect(caretOnBlockEdge('first')).toBe(true); expect(caretOnBlockEdge('last')).toBe(true);
        block.className = ''; expect(caretOnBlockEdge('first')).toBe(false);
        window.getSelection()?.removeAllRanges(); expect(caretOnBlockEdge('last')).toBe(false);
    });
});

describe('effect inputs', () => {
    it('accepts the real Gnosi editor schema, not a generic BlockNote cast', () => {
        expectTypeOf<GnosiEditor>().toExtend<EffectsEditor>();
    });
    it('resolves table id precedence and accented names from unknown metadata', () => {
        const tables = [null, { id: 'a', name: 'Àrees' }, { id: 'b', name: 'Notes' }];
        expect(belongsToAreas({ table_id: 'a' }, tables)).toBe(true);
        expect(belongsToAreas({ table_id: 'b', database_table_id: 'a' }, tables)).toBe(false);
        expect(belongsToAreas({ table_id: '', database_table_id: 'a' }, tables)).toBe(true);
        expect(belongsToAreas({ table_id: 'missing' }, tables)).toBe(false);
        expect(belongsToAreas(null)).toBe(false);
    });
});
