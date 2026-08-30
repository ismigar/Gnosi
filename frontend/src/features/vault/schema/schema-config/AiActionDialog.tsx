import React from 'react';
import type { SchemaConfigModel } from './useSchemaConfig';
import { createPortal } from 'react-dom';
import { Sparkles, X, Loader2 } from 'lucide-react';
export function AiActionDialog({ model }: { model: SchemaConfigModel }) {
    const {
        t, setAiActionModalFieldIndex, setAiActionPrompt, aiActionModalFieldIndex, aiActionPrompt,
        aiActionLoading, handleGenerateAiAction,
    } = model;
    return <>
        {/* AI Action Programmer Modal — rendered through its OWN portal so it
            stacks above this modal's backdrop (which creates its own stacking
            context and would otherwise swallow the nested z-index). */}
        {aiActionModalFieldIndex !== null && createPortal(
            <div className="fixed inset-0 z-[10100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="w-full max-w-md bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-2xl overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                        <div className="flex items-center gap-2 text-[var(--gnosi-primary)] font-semibold text-sm">
                            <Sparkles size={16} />
                            <span>{t('schema.button_ai_modal_title', "Program button action with AI")}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => { setAiActionModalFieldIndex(null); }}
                            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded-md"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <div className="p-4 space-y-3">
                        <p className="text-xs text-[var(--text-secondary)]">
                            {t('schema.button_ai_modal_desc', "Describe in natural language what action you want this button to perform.")}
                        </p>
                        <textarea
                            rows={4}
                            value={aiActionPrompt}
                            onChange={(e) => { setAiActionPrompt(e.target.value); }}
                            placeholder={t('schema.button_ai_modal_placeholder', "Type your request here...")}
                            className="w-full text-xs p-2.5 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none resize-none"
                            autoFocus
                        />
                    </div>
                    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                        <button
                            type="button"
                            onClick={() => { setAiActionModalFieldIndex(null); }}
                            className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
                        >
                            {t('common.cancel', "Cancel")}
                        </button>
                        <button
                            type="button"
                            disabled={!aiActionPrompt.trim() || aiActionLoading}
                            onClick={() => { void handleGenerateAiAction(); }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--gnosi-primary)] hover:opacity-90 text-white disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
                        >
                            {aiActionLoading ? (
                                <>
                                    <Loader2 size={12} className="animate-spin" />
                                    <span>{t('schema.button_ai_generating', "Generant...")}</span>
                                </>
                            ) : (
                                <>
                                    <Sparkles size={12} />
                                    <span>{t('schema.button_program_ai', "Programar amb IA ✨")}</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        )}
    </>;
}
