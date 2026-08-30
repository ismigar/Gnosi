import { useEffect } from 'react';
import { subscribeElementEvent, eventTargetClosest } from '../../../../shared/platform/browser-events';
import { saveToggleExpansionState, saveToggleDomExpansionState, restoreToggleDomExpansionState } from '../../toggleExpansionStateUtils';
import type { EditorEffectBase } from './types';

export function useTogglePersistence({ editor, editorWrapperRef, editorReady, noteFilename }: EditorEffectBase & { noteFilename?: string | null }) {
    useEffect(() => {
        // The old cleanup reads the ref at disposal, not the mount-time node.
        const ref = editorWrapperRef;
        return () => {
            saveToggleExpansionState(noteFilename, editor.document);
            saveToggleDomExpansionState(noteFilename, ref.current);
        };
    }, [editor, noteFilename, editorWrapperRef]);

    useEffect(() => {
        const wrapper = editorWrapperRef.current;
        if (!wrapper || !noteFilename) return;
        let timer: number | null = null;
        const unsubscribe = subscribeElementEvent(wrapper, 'click', (event) => {
            if (!eventTargetClosest(event.target, '.bn-toggle-button')) return;
            timer = window.setTimeout(() => {
                saveToggleExpansionState(noteFilename, editor.document);
                saveToggleDomExpansionState(noteFilename, wrapper);
            }, 0);
        });
        return () => {
            unsubscribe();
            if (timer) window.clearTimeout(timer);
        };
    }, [editor, noteFilename, editorWrapperRef]);

    useEffect(() => {
        const wrapper = editorWrapperRef.current;
        if (!wrapper || !noteFilename) return;
        let timer: number | null = null;
        const restore = () => {
            if (timer) window.clearTimeout(timer);
            timer = window.setTimeout(() => { restoreToggleDomExpansionState(noteFilename, wrapper); }, 150);
        };
        restore();
        const unsubscribe = editor.onChange(restore);
        return () => {
            if (timer) window.clearTimeout(timer);
            unsubscribe();
        };
    }, [editor, noteFilename, editorReady, editorWrapperRef]);
}
