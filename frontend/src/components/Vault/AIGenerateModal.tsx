import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { toast } from '../../lib/toast';
import { generateAiContent } from '../../shared/api/ai';


type AiGenerateMode = 'continue' | 'free' | 'improve' | 'summarize' | 'translate';
type Translate = (key: string, options: { readonly defaultValue: string }) => unknown;


export interface AiGenerateRequest {
    readonly anchor?: unknown;
    readonly context?: string | null;
    readonly mode?: AiGenerateMode;
}


interface AIGenerateModalProps {
    readonly onClose: () => void;
    readonly onInsert: (markdown: string, anchor: unknown) => unknown;
    readonly request: AiGenerateRequest | null;
    readonly t?: Translate;
}


interface OpenAIGenerateModalProps extends Omit<AIGenerateModalProps, 'request'> {
    readonly request: AiGenerateRequest;
}


const PRESETS: ReadonlyArray<{
    readonly labelKey: string;
    readonly labelFallback: string;
    readonly mode: AiGenerateMode;
}> = [
    { mode: 'free', labelKey: 'editor.ai_preset_free', labelFallback: 'Free-form' },
    { mode: 'continue', labelKey: 'editor.ai_preset_continue', labelFallback: 'Continue' },
    { mode: 'summarize', labelKey: 'editor.ai_preset_summarize', labelFallback: 'Summarize' },
    { mode: 'improve', labelKey: 'editor.ai_preset_improve', labelFallback: 'Improve' },
    { mode: 'translate', labelKey: 'editor.ai_preset_translate', labelFallback: 'Translate' },
];


function OpenAIGenerateModal({ request, onClose, onInsert, t }: OpenAIGenerateModalProps) {
    const tr = useCallback((key: string, defaultValue: string): string => {
        try {
            const translated = t?.(key, { defaultValue });
            return typeof translated === 'string' && translated ? translated : defaultValue;
        } catch {
            return defaultValue;
        }
    }, [t]);
    const [mode, setMode] = useState<AiGenerateMode>(request.mode ?? 'free');
    const [prompt, setPrompt] = useState('');
    const [language, setLanguage] = useState('English');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            inputRef.current?.focus();
        }, 60);
        return () => {
            clearTimeout(timeoutId);
        };
    }, []);

    const handleClose = useCallback((): void => {
        if (!loading) onClose();
    }, [loading, onClose]);

    useModalKeyboard({
        closeOnEscape: !loading,
        containerRef: dialogRef,
        isOpen: true,
        onClose: handleClose,
        trapFocus: true,
    });

    const needsPrompt = mode === 'free';
    const generate = useCallback(async (): Promise<void> => {
        if (loading) return;
        if (needsPrompt && !prompt.trim()) {
            inputRef.current?.focus();
            return;
        }
        setLoading(true);
        setResult('');
        try {
            const data = await generateAiContent({
                context: request.context ?? null,
                language: mode === 'translate' ? language : null,
                mode,
                prompt: prompt.trim() || null,
            });
            const content = data.content.trim();
            if (!content) toast.error(tr('editor.ai_empty', 'The AI returned no content.'));
            else setResult(content);
        } catch (error) {
            const detail = error instanceof Error ? error.message : tr('common.error', 'Error');
            toast.error(`${tr('editor.ai_error', 'Could not generate content')}: ${detail}`);
        } finally {
            setLoading(false);
        }
    }, [language, loading, mode, needsPrompt, prompt, request.context, tr]);

    const insert = useCallback((): void => {
        if (!result) return;
        void onInsert(result, request.anchor ?? null);
        onClose();
    }, [onClose, onInsert, request.anchor, result]);

    const onCtrlEnter = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void generate();
        }
    };

    return createPortal(<div className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center bg-black/40 pt-[12vh] px-4">
        <div
            ref={dialogRef}
            className="w-full max-w-xl rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={tr('editor.ai_title', 'Generate with AI')}
        >
            <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
                <Sparkles size={18} className="text-violet-500" />
                <span className="font-medium">{tr('editor.ai_title', 'Generate with AI')}</span>
                <button
                    type="button"
                    onClick={handleClose}
                    className="ml-auto rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                    aria-label={tr('common.close', 'Close')}
                    data-autofocus={mode !== 'free' ? true : undefined}
                >
                    <X size={18} />
                </button>
            </div>

            <div className="p-4 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((preset) => <button
                        key={preset.mode}
                        type="button"
                        onClick={() => {
                            setMode(preset.mode);
                            setResult('');
                        }}
                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${mode === preset.mode
                            ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-300'
                            : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                    >
                        {tr(preset.labelKey, preset.labelFallback)}
                    </button>)}
                </div>

                {mode === 'translate' ? <input
                    type="text"
                    value={language}
                    onChange={(event) => {
                        setLanguage(event.target.value);
                    }}
                    placeholder={tr('editor.ai_language_placeholder', 'Target language (for example, English)')}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-violet-500"
                /> : null}

                <textarea
                    ref={inputRef}
                    data-autofocus={mode === 'free' ? true : undefined}
                    value={prompt}
                    onChange={(event) => {
                        setPrompt(event.target.value);
                    }}
                    onKeyDown={onCtrlEnter}
                    rows={3}
                    placeholder={needsPrompt
                        ? tr('editor.ai_prompt_placeholder', 'What would you like the AI to write?')
                        : tr('editor.ai_prompt_extra_placeholder', 'Additional instructions (optional)…')}
                    className="w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-violet-500"
                />

                {result ? <div className="max-h-64 overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-sm whitespace-pre-wrap">
                    {result}
                </div> : null}
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--border-color)] px-4 py-3">
                {!result ? <button
                    type="button"
                    onClick={() => {
                        void generate();
                    }}
                    disabled={loading || (needsPrompt && !prompt.trim())}
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    {loading ? tr('editor.ai_generating', 'Generating…') : tr('editor.ai_generate', 'Generate')}
                </button> : <>
                    <button type="button" onClick={insert} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
                        <Check size={16} />
                        {tr('editor.ai_insert', 'Insert')}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void generate();
                        }}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                    >
                        {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {tr('editor.ai_retry', 'Try again')}
                    </button>
                </>}
                <span className="ml-auto text-xs text-[var(--text-secondary)]">⌘↵</span>
            </div>
        </div>
    </div>, document.body);
}


export default function AIGenerateModal(props: AIGenerateModalProps) {
    if (!props.request) return null;
    return <OpenAIGenerateModal {...props} request={props.request} />;
}
