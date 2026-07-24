import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Loader2, X, RefreshCw, Check } from 'lucide-react';
import axios from 'axios';
import { toast } from '../../lib/toast';

/**
 * AI content-generation modal for the Vault editor (Notion style).
 *
 * Free-form prompt + presets (continue, summarize, improve, translate). Generates via
 * `POST /api/ai/generate`, shows the result for review and, on confirmation,
 * calls `onInsert(markdown, anchor)` so the BlockEditor converts it into
 * blocks and saves it.
 *
 * Props:
 *   request: { mode, context, anchor } | null  — opens the modal when not null
 *   onClose():            closes (X / Esc / click outside)
 *   onInsert(md, anchor): inserts the generated markdown at the `anchor` position
 *   t:                    i18n function (optional; falls back to defaultValue)
 */
export default function AIGenerateModal({ request, onClose, onInsert, t }) {
    const tr = useCallback(
        (key, defaultValue) => {
            try {
                return (typeof t === 'function' ? t(key, { defaultValue }) : defaultValue) || defaultValue;
            } catch {
                return defaultValue;
            }
        },
        [t],
    );

    const PRESETS = [
        { mode: 'free', label: tr('editor.ai_preset_free', 'Free-form') },
        { mode: 'continue', label: tr('editor.ai_preset_continue', 'Continue') },
        { mode: 'summarize', label: tr('editor.ai_preset_summarize', 'Summarize') },
        { mode: 'improve', label: tr('editor.ai_preset_improve', 'Improve') },
        { mode: 'translate', label: tr('editor.ai_preset_translate', 'Translate') },
    ];

    const [mode, setMode] = useState('free');
    const [prompt, setPrompt] = useState('');
    const [language, setLanguage] = useState('English');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState('');
    const inputRef = useRef(null);

    const open = !!request;

    // Resets the state every time it opens with a new request.
    useEffect(() => {
        if (request) {
            setMode(request.mode || 'free');
            setPrompt('');
            setResult('');
            setLoading(false);
            setTimeout(() => inputRef.current?.focus(), 60);
        }
    }, [request]);

    const handleClose = useCallback(() => {
        if (loading) return; // don't close while generating
        onClose?.();
    }, [loading, onClose]);

    // Esc to close.
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                handleClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, handleClose]);

    const needsPrompt = mode === 'free';

    const generate = useCallback(async () => {
        if (loading) return;
        if (needsPrompt && !prompt.trim()) {
            inputRef.current?.focus();
            return;
        }
        setLoading(true);
        setResult('');
        try {
            const { data } = await axios.post('/api/ai/generate', {
                prompt: prompt.trim(),
                context: request?.context || '',
                mode,
                language: mode === 'translate' ? language : undefined,
            });
            const content = (data?.content || '').trim();
            if (!content) {
                toast.error(tr('editor.ai_empty', 'The AI returned no content.'));
            } else {
                setResult(content);
            }
        } catch (err) {
            const detail = err?.response?.data?.detail || err?.message || tr('common.error', 'Error');
            toast.error(`${tr('editor.ai_error', 'Could not generate content')}: ${detail}`);
        } finally {
            setLoading(false);
        }
    }, [loading, needsPrompt, prompt, request, mode, language, tr]);

    const insert = useCallback(() => {
        if (!result) return;
        onInsert?.(result, request?.anchor || null);
        onClose?.();
    }, [result, onInsert, request, onClose]);

    if (!open) return null;

    const onCtrlEnter = (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            generate();
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[100000] flex items-start justify-center bg-black/40 pt-[12vh] px-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
            <div
                className="w-full max-w-xl rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl"
                role="dialog"
                aria-label={tr('editor.ai_title', 'Generate with AI')}
            >
                {/* Header */}
                <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
                    <Sparkles size={18} className="text-violet-500" />
                    <span className="font-medium">{tr('editor.ai_title', 'Generate with AI')}</span>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="ml-auto rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                        aria-label={tr('common.close', 'Close')}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    {/* Presets */}
                    <div className="flex flex-wrap gap-1.5">
                        {PRESETS.map((p) => (
                            <button
                                key={p.mode}
                                type="button"
                                onClick={() => { setMode(p.mode); setResult(''); }}
                                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                                    mode === p.mode
                                        ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-300'
                                        : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* Target language (only for translation) */}
                    {mode === 'translate' && (
                        <input
                            type="text"
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                            placeholder={tr('editor.ai_language_placeholder', 'Target language (for example, English)')}
                            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-violet-500"
                        />
                    )}

                    {/* Free-form instruction */}
                    <textarea
                        ref={inputRef}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={onCtrlEnter}
                        rows={3}
                        placeholder={
                            needsPrompt
                                ? tr('editor.ai_prompt_placeholder', 'What would you like the AI to write?')
                                : tr('editor.ai_prompt_extra_placeholder', 'Additional instructions (optional)…')
                        }
                        className="w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-violet-500"
                    />

                    {/* Generated result */}
                    {result && (
                        <div className="max-h-64 overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-sm whitespace-pre-wrap">
                            {result}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 border-t border-[var(--border-color)] px-4 py-3">
                    {!result ? (
                        <button
                            type="button"
                            onClick={generate}
                            disabled={loading || (needsPrompt && !prompt.trim())}
                            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                            {loading ? tr('editor.ai_generating', 'Generating…') : tr('editor.ai_generate', 'Generate')}
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={insert}
                                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
                            >
                                <Check size={16} />
                                {tr('editor.ai_insert', 'Insert')}
                            </button>
                            <button
                                type="button"
                                onClick={generate}
                                disabled={loading}
                                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                            >
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                {tr('editor.ai_retry', 'Try again')}
                            </button>
                        </>
                    )}
                    <span className="ml-auto text-xs text-[var(--text-secondary)]">⌘↵</span>
                </div>
            </div>
        </div>,
        document.body,
    );
}
