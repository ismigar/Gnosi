import type { MouseEvent } from 'react';
import { AddBlockButton, DragHandleButton, SideMenu, useBlockNoteEditor, useExtensionState } from '@blocknote/react';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { NodeSelection } from 'prosemirror-state';
type EditorView = ReturnType<typeof useBlockNoteEditor>['prosemirrorView'];

// A deferred menu callback may outlive the mounted third-party view.
function currentView(editor: { readonly prosemirrorView?: EditorView }): EditorView | undefined {
    return editor.prosemirrorView;
}

/** Select the complete block after the drag handle's own focus/menu handling. */
export function SelectableSideMenu() {
    const editor = useBlockNoteEditor();
    const block = useExtensionState(SideMenuExtension, { editor, selector: state => state?.block });
    const selectBlock = (event: MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !block?.id || !currentView(editor)) return;
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.closest('[data-test="dragHandle"]')) return;
        let blockPosition: number | undefined;
        editor.prosemirrorState.doc.descendants((node, position) => {
            const id: unknown = node.attrs.id;
            if (blockPosition === undefined && id === block.id) blockPosition = position;
        });
        if (blockPosition === undefined) return;
        const position = blockPosition + 1;
        window.setTimeout(() => {
            const view = currentView(editor);
            if (!view) return;
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)));
            view.focus();
            view.dom.querySelectorAll('.gnosi-block-selected').forEach(element => { element.classList.remove('gnosi-block-selected'); });
            const selected = view.nodeDOM(position);
            const outer = selected instanceof HTMLElement ? selected.closest('.bn-block-outer') : null;
            outer?.classList.add('gnosi-block-selected');
        }, 0);
    };
    return <SideMenu><AddBlockButton /><div onClickCapture={selectBlock}><DragHandleButton /></div></SideMenu>;
}
