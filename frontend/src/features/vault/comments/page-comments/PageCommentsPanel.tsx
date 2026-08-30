import { Loader2, MessageSquare, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PageCommentCard } from './PageCommentCard';
import { PageCommentsComposer } from './PageCommentsComposer';
import type { PageCommentsPanelProps } from './types';


export function PageCommentsPanel({
    canComment,
    controller,
    onClose,
    pageTitle,
    panelRef,
}: PageCommentsPanelProps) {
    const { t } = useTranslation();
    return (
        <div className="fixed inset-0 z-[var(--z-modal)] flex justify-end animate-in fade-in duration-150">
            <button
                aria-label={t('common.close', 'Close')}
                className="absolute inset-0 bg-black/30"
                onClick={onClose}
                type="button"
            />
            <div
                aria-modal="true"
                className="relative w-full max-w-md h-full bg-[var(--bg-primary)] border-l border-[var(--border-primary)] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
                ref={panelRef}
                role="dialog"
            >
                <div className="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)]">
                    <div className="flex items-center gap-2 min-w-0">
                        <MessageSquare className="text-[var(--gnosi-blue)] shrink-0" size={18} />
                        <div className="min-w-0">
                            <h3 className="text-base font-bold text-[var(--text-primary)] truncate">
                                {t('shell.view_comments', 'Comments')}
                            </h3>
                            {pageTitle ? (
                                <p className="text-xs text-[var(--text-tertiary)] truncate">
                                    {pageTitle}
                                </p>
                            ) : null}
                        </div>
                    </div>
                    <button
                        aria-label={t('common.close', 'Close')}
                        className="gnosi-close-btn"
                        onClick={onClose}
                        type="button"
                    >
                        <X />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-3">
                    {controller.loading ? (
                        <div className="flex items-center justify-center py-12 text-[var(--text-tertiary)]">
                            <Loader2 className="animate-spin mr-2" size={18} />
                            {t('common.loading', 'Loading...')}
                        </div>
                    ) : controller.comments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)]">
                            <MessageSquare className="mb-2 opacity-40" size={28} />
                            <p className="text-sm">
                                {t('comments.empty', 'No comments yet')}
                            </p>
                        </div>
                    ) : controller.comments.map((comment) => (
                        <PageCommentCard
                            canComment={canComment}
                            comment={comment}
                            editDraft={controller.editDraft}
                            editing={controller.editingId === comment.id}
                            key={comment.id}
                            onDelete={controller.selectDeleteTarget}
                            onEditDraftChange={controller.setEditDraft}
                            onSave={controller.saveEdit}
                            onStartEditing={controller.startEditing}
                            onStopEditing={controller.stopEditing}
                            onToggleResolved={controller.toggleResolved}
                        />
                    ))}
                </div>
                <div className="border-t border-[var(--border-primary)] p-3 bg-[var(--bg-secondary)]/50">
                    <PageCommentsComposer
                        canComment={canComment}
                        draft={controller.draft}
                        onDraftChange={controller.setDraft}
                        onSubmit={controller.submitComment}
                        submitting={controller.submitting}
                    />
                </div>
            </div>
        </div>
    );
}
