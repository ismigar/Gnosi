import { act, Profiler, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TableOfContentsBlock, { type TableOfContentsBlockProps } from './TableOfContentsBlock';

const translate = (_key: string, fallback: string) => fallback;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
type Editor = NonNullable<TableOfContentsBlockProps['editor']>;

function heading(id: string, text: string, level = 1) {
    return { id, type: 'heading', props: { level }, content: [{ text }] };
}

function editorFixture(initial: unknown = []) {
    let current = initial;
    const listeners = new Set<() => void>();
    const registered: (() => void)[] = [];
    const cleanup = vi.fn();
    const editor: Editor = {
        get document() { return current; },
        onChange: vi.fn(function (this: Editor, listener: () => void) {
            expect(this).toBe(editor);
            listeners.add(listener);
            registered.push(listener);
            return () => { cleanup(); listeners.delete(listener); };
        }),
    };
    return { editor, cleanup, registered, listeners,
        setDocument: (next: unknown) => { current = next; },
        notify: () => { for (const listener of listeners) listener(); },
    };
}

describe('TableOfContentsBlock external document subscription', () => {
    let container: HTMLDivElement;
    let root: Root;
    const render = (editor?: Editor | null) => {
        act(() => { root.render(<TableOfContentsBlock editor={editor} />); });
    };

    beforeEach(() => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        vi.unstubAllGlobals();
    });

    it('renders nested headings and inline titles in order with relative indentation', () => {
        const fixture = editorFixture([
            heading('first', ' First ', 2),
            { type: 'column', children: [{ ...heading('nested', '', 4), content: [
                { text: 'Wiki ' }, { props: { title: 'Title' } }, { props: { label: 3 } },
                null, { props: { title: {} } },
            ] }] },
            heading('blank', '   '),
        ]);
        render(fixture.editor);
        expect([...container.querySelectorAll('button')].map(button => button.textContent)).toEqual(['First', 'Wiki Title3']);
        expect([...container.querySelectorAll('li')].map(item => item.style.paddingLeft)).toEqual(['0px', '32px']);
        expect(container.querySelector('.bn-toc')?.getAttribute('contenteditable')).toBe('false');
    });

    it('refreshes on notifications, including in-place document mutations', () => {
        const document = [heading('same-id', 'Original')];
        const fixture = editorFixture(document);
        render(fixture.editor);
        const button = container.querySelector('button');
        const first = document[0];
        if (!first) throw new Error('Missing heading fixture');
        first.content = [{ text: 'Changed' }];
        act(() => { fixture.notify(); });
        expect(container.querySelector('button')).toBe(button);
        expect(button?.textContent).toBe('Changed');
        fixture.setDocument([]);
        act(() => { fixture.notify(); });
        expect(container.textContent).toContain('Add headings to generate the index.');
    });

    it('does not re-render or resubscribe for semantically identical heading notifications', () => {
        const fixture = editorFixture([heading('same-id', 'Stable')]);
        const rendered = vi.fn();
        act(() => { root.render(<Profiler id="toc" onRender={rendered}><TableOfContentsBlock editor={fixture.editor} /></Profiler>); });
        const commits = rendered.mock.calls.length;
        fixture.setDocument([heading('same-id', 'Stable'), { type: 'paragraph', content: [{ text: 'Unrelated' }] }]);
        act(() => { fixture.notify(); fixture.notify(); });
        expect(rendered).toHaveBeenCalledTimes(commits);
        expect(fixture.editor.onChange).toHaveBeenCalledTimes(1);
    });

    it('captures changes occurring during subscription without an explicit notification', () => {
        let document = [heading('before', 'Before subscribe')];
        const editor: Editor = {
            get document() { return document; },
            onChange: () => { document = [heading('after', 'After subscribe')]; return undefined; },
        };
        render(editor);
        expect(container.textContent).toContain('After subscribe');
        expect(container.textContent).not.toContain('Before subscribe');
    });

    it('swaps editors without remounting and ignores callbacks retained by the old editor', () => {
        const first = editorFixture([heading('first', 'First editor')]);
        const second = editorFixture([heading('second', 'Second editor')]);
        render(first.editor);
        const wrapper = container.querySelector('.bn-toc');
        render(second.editor);
        expect(container.querySelector('.bn-toc')).toBe(wrapper);
        expect(first.cleanup).toHaveBeenCalledTimes(1);
        expect(first.listeners.size).toBe(0);
        expect(container.textContent).toContain('Second editor');
        first.setDocument([heading('stale', 'Stale editor')]);
        act(() => { first.registered[0]?.(); });
        expect(container.textContent).not.toContain('Stale editor');
        expect(container.textContent).toContain('Second editor');
    });

    it('handles missing editors and read-only document providers', () => {
        render();
        expect(container.textContent).toContain('Add headings');
        render({ document: [heading('static', 'Static document')] });
        expect(container.textContent).toContain('Static document');
        render(null);
        expect(container.textContent).not.toContain('Static document');
    });

    it('tolerates unready documents and throwing subscription/cleanup implementations', () => {
        render({ get document(): unknown { throw new Error('not ready'); }, onChange: () => { throw new Error('unavailable'); } });
        expect(container.textContent).toContain('Add headings');
        render({ document: [heading('safe', 'Safe')], onChange: () => () => { throw new Error('cleanup'); } });
        expect(() => { render(null); }).not.toThrow();
    });

    it('scrolls the matching heading with the existing smooth navigation payload', () => {
        const target = document.createElement('div');
        target.setAttribute('data-id', 'scroll-target');
        const scroll = vi.fn();
        target.scrollIntoView = scroll;
        document.body.appendChild(target);
        try {
            render({ document: [heading('scroll-target', 'Scroll here')] });
            const button = container.querySelector('button');
            if (!button) throw new Error('Missing TOC entry');
            act(() => { button.click(); });
            expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'smooth', block: 'start' });
        } finally { target.remove(); }
    });

    it('cleans up replayed StrictMode subscriptions and makes unmounted callbacks inert', () => {
        const fixture = editorFixture([heading('strict', 'Strict heading')]);
        act(() => { root.render(<StrictMode><TableOfContentsBlock editor={fixture.editor} /></StrictMode>); });
        expect(fixture.listeners.size).toBe(1);
        expect(fixture.cleanup).toHaveBeenCalledTimes(1);
        act(() => { root.render(null); });
        expect(fixture.listeners.size).toBe(0);
        expect(fixture.cleanup).toHaveBeenCalledTimes(2);
        fixture.setDocument([heading('late', 'Late')]);
        expect(() => { act(() => { for (const listener of fixture.registered) listener(); }); }).not.toThrow();
        expect(container.textContent).toBe('');
    });
});
