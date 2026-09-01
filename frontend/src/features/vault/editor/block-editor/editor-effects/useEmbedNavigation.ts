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
