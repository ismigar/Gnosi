import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BookPlus, EyeOff, SpellCheck2 } from 'lucide-react';
import { detectLang } from '../../lib/spellcheck/detectLang';
import { loadSpeller, addPersonalWord } from '../../lib/spellcheck/nspellManager';
import {
    createSpellcheckPlugin,
    requestRecompute,
    spellErrorAt,
    spellPluginKey,
} from '../../lib/spellcheck/spellcheckPlugin';

/**
 * SpellCheckLayer
 * Spell checker inside the BlockNote editor (ProseMirror). Registers a
 * decorations plugin that underlines mistakes according to the nspell dictionary for the
 * language detected on the page, and shows a suggestions menu on click.
 *
 * Fully client-side; the language is detected automatically (auto per page) and can
 * be forced with `forcedLang`.
 */
export default function SpellCheckLayer({ editor, enabled = true, pageId, forcedLang, onLangDetected }) {
    const { t } = useTranslation();
    const spellerRef = useRef(null);
    const ignoredRef = useRef(new Set());
    const enabledRef = useRef(enabled);
    const [menu, setMenu] = useState(null); // {x,y,from,to,word,suggestions}

    // Context read lazily by the plugin (speller loads asynchronously, language changes on the fly).
    const getContext = useCallback(() => ({
        enabled: enabledRef.current,
        speller: spellerRef.current,
        ignored: ignoredRef.current,
    }), []);

    const view = () => editor?.prosemirrorView || null;

    // 1) Registers the plugin once per editor instance.
    useEffect(() => {
        if (!editor?._tiptapEditor) return undefined;
        const plugin = createSpellcheckPlugin(getContext);
        editor._tiptapEditor.registerPlugin(plugin);
        return () => {
            try { editor._tiptapEditor.unregisterPlugin(spellPluginKey); } catch { /* noop */ }
        };
    }, [editor, getContext]);

    // 2) Syncs the activation flag and recalculates.
    useEffect(() => {
        enabledRef.current = enabled;
        requestRecompute(view());
    }, [enabled, editor]); // eslint-disable-line react-hooks/exhaustive-deps

    // 3) Detects the page language and loads the corresponding dictionary.
    useEffect(() => {
        if (!editor || !enabled) return undefined;
        let cancelled = false;
        (async () => {
            const plainText = (editor.document || [])
                .map((b) => (Array.isArray(b.content)
                    ? b.content.map((c) => c.text || '').join('')
                    : ''))
                .join(' ')
                .trim();
            const lang = forcedLang || (await detectLang(plainText)) || 'en';
            if (cancelled) return;
            onLangDetected?.(lang);
            const speller = await loadSpeller(lang);
            if (cancelled || !speller) return;
            spellerRef.current = speller;
            requestRecompute(view());
        })();
        return () => { cancelled = true; };
    }, [editor, enabled, pageId, forcedLang]); // eslint-disable-line react-hooks/exhaustive-deps

    // 4) Click on a flagged word → opens the suggestions menu.
    useEffect(() => {
        if (!editor || !enabled) return undefined;
        const dom = editor.prosemirrorView?.dom;
        if (!dom) return undefined;

        const onClick = (e) => {
            const span = e.target.closest?.('.gnosi-spell-error');
            if (!span) return;
            e.preventDefault();
            e.stopPropagation();
            const v = view();
            if (!v) return;
            let info = null;
            try {
                const pos = v.posAtDOM(span, 0);
                info = spellErrorAt(v.state, pos) || spellErrorAt(v.state, pos + 1);
            } catch { info = null; }
            if (!info) return;
            const rect = span.getBoundingClientRect();
            let suggestions = [];
            try { suggestions = (spellerRef.current?.suggest(info.word) || []).slice(0, 7); } catch { suggestions = []; }
            setMenu({ x: rect.left, y: rect.bottom + 4, ...info, suggestions });
        };

        dom.addEventListener('mousedown', onClick, true);
        dom.addEventListener('contextmenu', onClick, true);
        return () => {
            dom.removeEventListener('mousedown', onClick, true);
            dom.removeEventListener('contextmenu', onClick, true);
        };
    }, [editor, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

    // Closes the menu on click outside / Escape / scroll.
    useEffect(() => {
        if (!menu) return undefined;
        const close = (e) => {
            if (e.target?.closest?.('[data-gnosi-portal="spell-menu"]')) return;
            setMenu(null);
        };
        const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
        document.addEventListener('mousedown', close, true);
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', () => setMenu(null), true);
        return () => {
            document.removeEventListener('mousedown', close, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    const applySuggestion = (sugg) => {
        const v = view();
        if (!v || !menu) return;
        v.dispatch(v.state.tr.insertText(sugg, menu.from, menu.to));
        v.focus();
        setMenu(null);
        requestRecompute(v);
    };

    const addToDictionary = () => {
        if (!menu) return;
        addPersonalWord(menu.word);
        setMenu(null);
        requestRecompute(view());
    };

    const ignoreWord = () => {
        if (!menu) return;
        ignoredRef.current.add(menu.word.toLowerCase());
        setMenu(null);
        requestRecompute(view());
    };

    if (!menu) return null;

    const left = Math.min(menu.x, window.innerWidth - 230);
    const top = Math.min(menu.y, window.innerHeight - 260);

    return createPortal(
        <div
            data-gnosi-portal="spell-menu"
            style={{ position: 'fixed', top, left, width: 220, zIndex: 10050 }}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] py-1 shadow-xl"
        >
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                <SpellCheck2 size={12} /> {menu.word}
            </div>
            <div className="max-h-44 overflow-auto">
                {menu.suggestions.length === 0 ? (
                    <div className="px-3 py-1.5 text-xs italic text-[var(--text-tertiary)]">{t('editor.spellcheck_no_suggestions', "No suggestions")}</div>
                ) : menu.suggestions.map((s) => (
                    <button
                        key={s}
                        onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
                        className="block w-full px-3 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                    >
                        {s}
                    </button>
                ))}
            </div>
            <div className="mt-1 border-t border-[var(--border-primary)] pt-1">
                <button
                    onMouseDown={(e) => { e.preventDefault(); addToDictionary(); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                >
                    <BookPlus size={13} /> {t('editor.spellcheck_add_to_dictionary', "Add to dictionary")}
                </button>
                <button
                    onMouseDown={(e) => { e.preventDefault(); ignoreWord(); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                >
                    <EyeOff size={13} /> {t('editor.spellcheck_ignore_word', "Ignore this word")}
                </button>
            </div>
        </div>,
        document.body,
    );
}
