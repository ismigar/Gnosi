import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeElementEvent } from '../../../../../shared/platform/browser-events';
import type { EditorEffectBase } from './types';

/** Activate the native disclosure, retaining its expansion persistence and caret. */
export function useToggleKeyboard({ editor, editorWrapperRef, editorReady }: EditorEffectBase) {
    const { t } = useTranslation();
    useEffect(() => {
        const wrapper = editorWrapperRef.current;
        if (!wrapper || !editorReady) return;
        const decorate = () => {
            for (const button of wrapper.querySelectorAll<HTMLButtonElement>('.bn-toggle-button')) {
                const expanded = button.closest('.bn-toggle-wrapper')?.getAttribute('data-show-children') === 'true';
                const label = t(expanded ? 'editor.collapse_section' : 'editor.expand_section');
                button.tabIndex = 0;
                button.contentEditable = 'false';
                button.setAttribute('aria-expanded', String(expanded));
                button.setAttribute('aria-label', label);
                button.setAttribute('aria-keyshortcuts', 'Alt+Enter');
                button.title = `${label} (Alt/⌥+Enter)`;
            }
        };
        decorate();
        const observer = new MutationObserver(decorate);
        observer.observe(wrapper, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-show-children'] });
        const unsubscribe = subscribeElementEvent(wrapper, 'keydown', event => {
            if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey) return;
            if (!(event.target instanceof Element)) return;
            const target = event.target;
            if (target.closest('input, textarea, select, [role="dialog"], .gnosi-view-embed-container')) return;
            let button = target.closest<HTMLButtonElement>('.bn-toggle-button');
            if (button) {
                if (event.altKey || event.shiftKey || !['Enter', ' '].includes(event.key)) return;
            } else {
                if (event.key !== 'Enter' || !event.altKey || event.shiftKey || target.closest('button, a')) return;
                if (!target.closest('[contenteditable="true"]')) return;
                const blockId = editor.getTextCursorPosition().block.id;
                const block = Array.from(wrapper.querySelectorAll<HTMLElement>('.bn-block-outer[data-id]'))
                    .find(element => element.dataset.id === blockId);
                button = Array.from(block?.querySelectorAll<HTMLButtonElement>('.bn-toggle-button') ?? [])
                    .find(element => element.closest('.bn-block-outer') === block) ?? null;
            }
            if (!button || button.closest('.bn-editor') !== target.closest('.bn-editor')) return;
            event.preventDefault();
            event.stopPropagation();
            button.click();
            decorate();
        }, true);
        return () => { unsubscribe(); observer.disconnect(); };
    }, [editor, editorReady, editorWrapperRef, t]);
}
