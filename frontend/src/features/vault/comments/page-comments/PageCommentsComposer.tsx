import type { KeyboardEvent } from 'react';
import { Loader2, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';


interface PageCommentsComposerProps {
    readonly canComment: boolean;
    readonly draft: string;
    readonly onDraftChange: (draft: string) => void;
    readonly onSubmit: () => Promise<void>;
    readonly submitting: boolean;
}


export function PageCommentsComposer({
    canComment,
    draft,
    onDraftChange,
    onSubmit,
    submitting,
}: PageCommentsComposerProps) {
    const { t } = useTranslation();
    if (!canComment) {
        return (
            <p className="text-xs text-[var(--text-tertiary)] italic text-center py-1">
                {t('comments.read_only', 'Your role only allows reading comments')}
            </p>
        );
    }

    const submitOnShortcut = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void onSubmit();
        }
    };

    return (
        <div className="flex items-end gap-2">
            <textarea
                className="flex-1 px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/30 resize-none"
                onChange={(event) => {
                    onDraftChange(event.target.value);
                }}
                onKeyDown={submitOnShortcut}
                placeholder={t(
                    'comments.placeholder',
                    'Write a comment… (⌘+Enter to send)',
                )}
                rows={2}
                value={draft}
            />
            <button
                className="p-2.5 rounded-lg bg-[var(--gnosi-blue)] text-white hover:opacity-90 disabled:opacity-40 shrink-0"
                disabled={!draft.trim() || submitting}
                onClick={() => {
                    void onSubmit();
                }}
                title={t('comments.send', 'Send')}
                type="button"
            >
                {submitting
                    ? <Loader2 className="animate-spin" size={16} />
                    : <Send size={16} />}
            </button>
        </div>
    );
}
