import { act } from 'react';
import { EditorView } from '@codemirror/view';
import { afterAll, beforeAll } from 'vitest';

/** jsdom has no layout engine; leave editor state/transactions entirely real. */
export function mockCodeMirrorLayout() {
    const originals = ['getClientRects', 'getBoundingClientRect'].map(name => [name, Object.getOwnPropertyDescriptor(Range.prototype, name)] as const);
    beforeAll(() => {
        Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
    });
    afterAll(() => { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(Range.prototype, name, descriptor); else Reflect.deleteProperty(Range.prototype, name); } });
}
export function markdownView(container: HTMLElement): EditorView {
    const content = container.querySelector<HTMLElement>('.cm-content');
    const view = content && EditorView.findFromDOM(content);
    if (!view) throw new Error('Missing Markdown editor');
    return view;
}
export function replaceMarkdown(view: EditorView, value: string): void {
    act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } }); });
}
