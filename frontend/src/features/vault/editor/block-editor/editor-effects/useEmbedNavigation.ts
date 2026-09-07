import { useCallback, useEffect, useRef } from 'react';
import { subscribeElementEvent } from '../../../../../shared/platform/browser-events';
import { exitEmbed, focusFirstBlock } from './embedNavigation';
import { handleBodyKeyboard } from './bodyKeyboard';
import type { EmbedNavApi, NavigationInputs } from './types';

export function useEditorEmbedNavigation({ editor, editorWrapperRef, editorReady, registerEditorApi, onNavigateUp, onOpenProperties }: NavigationInputs) {
    const embedNavRef = useRef(new Map<string, EmbedNavApi>());
    const registerEmbedNav = useCallback((blockId: string, api: EmbedNavApi | null) => {
        if (!blockId) return;
        const navigation = embedNavRef.current;
        if (api) navigation.set(blockId, api); else navigation.delete(blockId);
    }, []);
    const exitEmbedToEditor = useCallback((blockId: string, direction: string) => {
        exitEmbed(editor, embedNavRef.current, blockId, direction, onNavigateUp);
    }, [editor, onNavigateUp]);

    useEffect(() => {
        if (!editorReady) return;
        const view = editor.prosemirrorView;
        const previous = view.props.handleDOMEvents;
        const handlers: NonNullable<typeof previous> = {
            ...previous,
            keydown: (currentView, event) => {
                // Let React's embedded controls handle the event, without the
                // parent editor moving its selection before React sees it.
                if (event.target instanceof Element && event.target.closest('.gnosi-view-embed-container')) return true;
                return previous?.keydown?.(currentView, event) ?? false;
            },
        };
        view.setProps({ handleDOMEvents: handlers });
        return () => {
            if (view.props.handleDOMEvents === handlers) view.setProps({ handleDOMEvents: previous });
        };
    }, [editor, editorReady]);

    useEffect(() => {
        if (!registerEditorApi) return;
        registerEditorApi({ focusFirstBlock: () => focusFirstBlock(editor, embedNavRef.current) });
        return () => { registerEditorApi(null); };
    }, [editor, registerEditorApi]);

    useEffect(() => {
        const wrapper = editorWrapperRef.current;
        if (!wrapper || !editorReady) return;
        return subscribeElementEvent(wrapper, 'keydown', (event) => {
            handleBodyKeyboard(event, { editor, navigation: embedNavRef.current, onNavigateUp, onOpenProperties });
        }, true);
    }, [editor, editorReady, editorWrapperRef, onNavigateUp, onOpenProperties]);

    return { embedNavRef, registerEmbedNav, exitEmbedToEditor };
}
