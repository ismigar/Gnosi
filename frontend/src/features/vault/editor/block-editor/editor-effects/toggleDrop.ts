import type { EditorView } from '@tiptap/pm/view';
import type { GnosiEditor } from '../schema';
import { editorView, type EffectsEditor, type ToggleDropHandler } from './types';
import { nestIntoToggle } from './toggleTree';

interface PointRoot { elementsFromPoint?: (x: number, y: number) => Element[]; }

/** Eight-pixel edge bands retain normal sibling reordering. */
export function findToggleDropTarget(wrapper: HTMLElement, root: PointRoot, x: number, y: number): string | null {
    const elements = root.elementsFromPoint?.(x, y) || [];
    for (const element of elements) {
        if (!wrapper.contains(element)) continue;
        if (element.closest('.bn-toggle-add-block-button')) {
            const id = element.closest('[data-id]')?.getAttribute('data-id');
            if (id) return id;
            continue;
        }
        const outer = element.closest('.bn-block-outer');
        const header = outer?.querySelector(':scope > .bn-block > .bn-block-content > div > .bn-toggle-wrapper');
        if (!outer || !header) continue;
        const id = outer.getAttribute('data-id');
        if (!id) continue;
        const rect = header.getBoundingClientRect();
        if (y < rect.top || y > rect.bottom) continue;
        const edge = Math.min(8, rect.height / 3);
        if (y < rect.top + edge || y > rect.bottom - edge) return null;
        return id;
    }
    return null;
}

export function getDraggedBlockIds(view: EditorView, editor: Pick<GnosiEditor, 'getBlock'>): string[] {
    const ids: string[] = [];
    view.state.selection.content().content.forEach((node) => {
        const id: unknown = node.attrs.id;
        if (typeof id === 'string' && id && editor.getBlock(id)) ids.push(id);
    });
    return ids;
}

export function createToggleDrop(editor: EffectsEditor, wrapper: HTMLElement) {
    let highlighted: Element | null = null;
    const setHighlight = (element: Element | null) => {
        if (highlighted === element) return;
        highlighted?.classList.remove('gnosi-toggle-drop-target');
        highlighted = element;
        highlighted?.classList.add('gnosi-toggle-drop-target');
        document.body.classList.toggle('gnosi-toggle-nesting', !!highlighted);
    };
    const targetAt = (x: number, y: number) => findToggleDropTarget(wrapper, editorView(editor)?.root ?? document, x, y);
    const onDragOver = (event: DragEvent) => {
        if (event.dataTransfer?.types.includes('Files')) return;
        const id = targetAt(event.clientX, event.clientY);
        if (!id) { setHighlight(null); return; }
        setHighlight(wrapper.querySelector(`.bn-block-outer[data-id="${CSS.escape(id)}"]`));
    };
    const reset = () => { setHighlight(null); };
    const handleDrop: ToggleDropHandler = (view, event, _slice, moved) => {
        reset();
        if (!moved || event.dataTransfer?.files.length) return false;
        const targetId = targetAt(event.clientX, event.clientY);
        const ids = targetId ? getDraggedBlockIds(view, editor) : [];
        if (!targetId || !ids.length) return false;
        try { return nestIntoToggle(editor, targetId, ids); }
        catch (error) { console.error('drop into toggle failed', error); return false; }
    };
    return { reset, onDragOver, handleDrop };
}
