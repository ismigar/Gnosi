import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpellCheckEditorPort } from './spell-check-layer/correctionEditorPort';
import { createPortal } from 'react-dom';
import { BookPlus, EyeOff, SpellCheck2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { detectLang } from './spellcheck/detectLang';
import {
    addPersonalWord,
    loadSpeller,
    type Speller,
} from './spellcheck/nspellManager';
import {
    createSpellcheckPlugin,
    requestRecompute,
    spellErrorAt,
    spellPluginKey,
    type SpellcheckContext,
} from './spellcheck/spellcheckPlugin';
import {
    browserDocumentBody,
    browserViewportSize,
    eventTargetClosest,
    subscribeDocumentEvent,
    subscribeElementEvent,
    subscribeWindowEvent,
} from '../../../shared/platform/browser-events';
import {
    extractEditorText,
    fitSpellMenu,
    getSpellSuggestions,
    type SpellMenuState,
} from './spell-check-layer/spellCheckModel';


interface SpellCheckLayerProps {
    readonly editor: SpellCheckEditorPort | null;
    readonly enabled?: boolean;
    readonly forcedLang?: string | null;
    readonly onLangDetected?: (language: string) => void;
    readonly pageId?: string | null;
}


function isAborted(controller: AbortController): boolean {
    return controller.signal.aborted;
}


export default function SpellCheckLayer({
    editor,
    enabled = true,
    pageId,
    forcedLang,
    onLangDetected,
}: SpellCheckLayerProps) {
    const { t } = useTranslation();
    const spellerRef = useRef<Speller | null>(null);
    const ignoredRef = useRef<Set<string>>(new Set());
    const enabledRef = useRef(enabled);
    const [menu, setMenu] = useState<SpellMenuState | null>(null);

    const getContext = useCallback((): SpellcheckContext => ({
        enabled: enabledRef.current,
        speller: spellerRef.current,
        ignored: ignoredRef.current,
    }), []);
    const view = useCallback(
        () => editor?.prosemirrorView ?? null,
        [editor],
    );

    useEffect(() => {
        const tiptapEditor = editor?._tiptapEditor;
        if (!tiptapEditor) return undefined;
        tiptapEditor.registerPlugin(createSpellcheckPlugin(getContext));
        return () => {
            try {
                tiptapEditor.unregisterPlugin(spellPluginKey);
            } catch {
                // The editor may already have been destroyed during page navigation.
            }
        };
    }, [editor, getContext]);

    useEffect(() => {
        enabledRef.current = enabled;
        requestRecompute(view());
    }, [enabled, view]);

    useEffect(() => {
        if (!editor || !enabled) return undefined;
        const controller = new AbortController();
        void (async () => {
            const plainText = extractEditorText(editor.document);
            const language = forcedLang || await detectLang(plainText) || 'en';
            if (isAborted(controller)) return;
            onLangDetected?.(language);
            const speller = await loadSpeller(language);
            if (isAborted(controller)) return;
            if (!speller) return;
            spellerRef.current = speller;
            requestRecompute(view());
        })().catch(() => {
            // Spell checking remains unavailable if detection or dictionary loading fails.
        });
        return () => {
            controller.abort();
        };
    }, [editor, enabled, forcedLang, onLangDetected, pageId, view]);

    useEffect(() => {
        const dom = editor?.prosemirrorView.dom;
        if (!dom || !enabled) return undefined;
        const openMenu = (event: MouseEvent): void => {
            const span = eventTargetClosest(event.target, '.gnosi-spell-error');
            if (!span) return;
            event.preventDefault();
            event.stopPropagation();
            const editorView = view();
            if (!editorView) return;
            let position: number;
            try {
                position = editorView.posAtDOM(span, 0);
            } catch {
                return;
            }
            const error = spellErrorAt(editorView.state, position)
                ?? spellErrorAt(editorView.state, position + 1);
            if (!error) return;
            const rectangle = span.getBoundingClientRect();
            setMenu({
                ...error,
                suggestions: getSpellSuggestions(spellerRef.current, error.word),
                x: rectangle.left,
                y: rectangle.bottom + 4,
            });
        };
        const unsubscribeMouse = subscribeElementEvent(dom, 'mousedown', openMenu, true);
        const unsubscribeContext = subscribeElementEvent(dom, 'contextmenu', openMenu, true);
        return () => {
            unsubscribeMouse();
            unsubscribeContext();
        };
    }, [editor, enabled, view]);

    useEffect(() => {
        if (!menu) return undefined;
        const unsubscribeMouse = subscribeDocumentEvent('mousedown', (event) => {
            if (eventTargetClosest(event.target, '[data-gnosi-portal="spell-menu"]')) return;
            setMenu(null);
        }, true);
        const unsubscribeKey = subscribeDocumentEvent('keydown', (event) => {
            if (event.key === 'Escape') setMenu(null);
        });
        const unsubscribeScroll = subscribeWindowEvent('scroll', () => {
            setMenu(null);
        }, true);
        return () => {
            unsubscribeMouse();
            unsubscribeKey();
            unsubscribeScroll();
        };
    }, [menu]);

    const applySuggestion = (suggestion: string): void => {
        const editorView = view();
        if (!editorView || !menu) return;
        editorView.dispatch(editorView.state.tr.insertText(suggestion, menu.from, menu.to));
        editorView.focus();
        setMenu(null);
        requestRecompute(editorView);
    };
    const addToDictionary = (): void => {
        if (!menu) return;
        addPersonalWord(menu.word);
        setMenu(null);
        requestRecompute(view());
    };
    const ignoreWord = (): void => {
        if (!menu) return;
        ignoredRef.current.add(menu.word.toLowerCase());
        setMenu(null);
        requestRecompute(view());
    };

    if (!menu) return null;
    const { left, top } = fitSpellMenu(menu, browserViewportSize());
    return createPortal(
        <div
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] py-1 shadow-xl"
            data-gnosi-portal="spell-menu"
            style={{ position: 'fixed', top, left, width: 220, zIndex: 'var(--z-modal-dropdown)' }}
        >
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                <SpellCheck2 size={12} /> {menu.word}
            </div>
            <div className="max-h-44 overflow-auto">
                {menu.suggestions.length === 0 ? (
                    <div className="px-3 py-1.5 text-xs italic text-[var(--text-tertiary)]">
                        {t('editor.spellcheck_no_suggestions', 'No suggestions')}
                    </div>
                ) : menu.suggestions.map((suggestion) => (
                    <button
                        className="block w-full px-3 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                        key={suggestion}
                        onMouseDown={(event) => {
                            event.preventDefault();
                            applySuggestion(suggestion);
                        }}
                    >
                        {suggestion}
                    </button>
                ))}
            </div>
            <div className="mt-1 border-t border-[var(--border-primary)] pt-1">
                <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                    onMouseDown={(event) => {
                        event.preventDefault();
                        addToDictionary();
                    }}
                >
                    <BookPlus size={13} /> {t('editor.spellcheck_add_to_dictionary', 'Add to dictionary')}
                </button>
                <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                    onMouseDown={(event) => {
                        event.preventDefault();
                        ignoreWord();
                    }}
                >
                    <EyeOff size={13} /> {t('editor.spellcheck_ignore_word', 'Ignore this word')}
                </button>
            </div>
        </div>,
        browserDocumentBody(),
    );
}
