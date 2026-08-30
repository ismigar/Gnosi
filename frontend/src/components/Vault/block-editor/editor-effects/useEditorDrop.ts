import { useEffect, useEffectEvent } from 'react';
import { subscribeDocumentEvent, subscribeElementEvent } from '../../../../shared/platform/browser-events';
import { isVisualMediaFile } from '../media';
import { processEditorFiles, placeCaretAtCoords } from './fileInsertion';
import { createToggleDrop } from './toggleDrop';
import { handleLinkPaste } from './linkPaste';
import type { DropEffectInputs } from './types';

export function useEditorDrop(inputs: DropEffectInputs): void {
    const { editor, editorWrapperRef, editorReady, requestInsertContent, uploadFileToAssetsDirect, toggleDropHandlerRef } = inputs;
    const process = useEffectEvent((files: File[]) => { void processEditorFiles(files, inputs); });
    const pasteLink = useEffectEvent((event: ClipboardEvent) => { handleLinkPaste(event, editor, inputs.setLinkPasteCtx); });
    useEffect(() => {
        const wrapper = editorWrapperRef.current;
        if (!wrapper || !editorReady) return;
        const toggle = createToggleDrop(editor, wrapper);
        toggleDropHandlerRef.current = toggle.handleDrop;
        const onDrop = (event: DragEvent) => {
            const files = Array.from(event.dataTransfer?.files || []);
            if (!files.length) { toggle.reset(); return; }
            // All-visual batches continue through BlockNote's native handlers.
            if (files.every(isVisualMediaFile)) return;
            event.preventDefault();
            event.stopPropagation();
            placeCaretAtCoords(editor, event.clientX, event.clientY);
            process(files);
        };
        const onPaste = (event: ClipboardEvent) => {
            const files = Array.from(event.clipboardData?.files || []);
            if (files.length) {
                if (files.every(isVisualMediaFile)) return;
                event.preventDefault();
                event.stopPropagation();
                process(files);
                return;
            }
            pasteLink(event);
        };
        const subscriptions = [
            subscribeElementEvent(wrapper, 'drop', onDrop, true),
            subscribeElementEvent(wrapper, 'paste', onPaste, true),
            subscribeElementEvent(wrapper, 'dragover', toggle.onDragOver, true),
            subscribeElementEvent(wrapper, 'dragend', toggle.reset, true),
            subscribeElementEvent(wrapper, 'dragleave', toggle.reset, true),
            subscribeDocumentEvent('dragend', toggle.reset, true),
            subscribeDocumentEvent('drop', toggle.reset, true),
        ];
        return () => {
            for (const unsubscribe of subscriptions) unsubscribe();
            toggleDropHandlerRef.current = null;
            toggle.reset();
        };
    }, [editor, editorReady, editorWrapperRef, requestInsertContent, uploadFileToAssetsDirect, toggleDropHandlerRef]);
}
