import { useEffect, useEffectEvent } from 'react';
import { subscribeWindowEvent } from '../../../../../shared/platform/browser-events';
import type { EditorEffectsInputs } from './types';

export function citeShortcutAllowed(event: KeyboardEvent, wrapper: HTMLElement | null): boolean {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'i') return false;
    const active = document.activeElement;
    const tag = active?.tagName.toLowerCase();
    const editable = tag === 'input' || tag === 'textarea' || (active instanceof HTMLElement && active.isContentEditable);
    return !editable || !!(wrapper && wrapper.contains(active));
}

export function useCiteShortcut({ editor, editorWrapperRef, setIsCitePickerOpen }: Pick<EditorEffectsInputs, 'editor' | 'editorWrapperRef' | 'setIsCitePickerOpen'>) {
    const open = useEffectEvent(() => { setIsCitePickerOpen(true); });
    useEffect(() => subscribeWindowEvent('keydown', (event) => {
        if (!citeShortcutAllowed(event, editorWrapperRef.current)) return;
        event.preventDefault();
        event.stopPropagation();
        open();
    }, true), [editor, editorWrapperRef]);
}
