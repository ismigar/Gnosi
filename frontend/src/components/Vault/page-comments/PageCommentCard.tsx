import { Check, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import i18n from '../../../i18n';
import type { VaultPageComment } from '../../../shared/api/vault-comments';
import { formatCommentDate } from './model';


interface PageCommentCardProps {
    readonly canComment: boolean;
    readonly comment: VaultPageComment;
    readonly editDraft: string;
    readonly editing: boolean;
    readonly onDelete: (comment: VaultPageComment) => void;
    readonly onEditDraftChange: (draft: string) => void;
    readonly onSave: (commentId: string) => Promise<void>;
    readonly onStartEditing: (comment: VaultPageComment) => void;
    readonly onStopEditing: () => void;
    readonly onToggleResolved: (comment: VaultPageComment) => Promise<void>;
}


export function PageCommentCard({
    canComment,
    comment,
    editDraft,
    editing,
    onDelete,
    onEditDraftChange,
    onSave,
    onStartEditing,
    onStopEditing,
    onToggleResolved,
}: PageCommentCardProps) {
    const { t } = useTranslation();
    return (
        <div className={`rounded-lg border p-3 ${comment.resolved ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)]/40'}`}>
            <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {comment.author}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                        {formatCommentDate(comment.created_at, i18n.language)}
                    </span>
                    {comment.resolved ? (
                        <span className="text-[9px] uppercase font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0">
                            {t('comments.resolved', 'Resolved')}
                        </span>
                    ) : null}
                </div>
                {canComment ? (
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-emerald-600"
                            onClick={() => {
                                void onToggleResolved(comment);
                            }}
                            title={comment.resolved
                                ? t('comments.reopen', 'Reopen')
                                : t('comments.resolve', 'Mark as resolved')}
                            type="button"
                        >
                            {comment.resolved
                                ? <RotateCcw size={13} />
                                : <Check size={13} />}
                        </button>
                        <button
                            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                            onClick={() => {
                                onStartEditing(comment);
                            }}
                            title={t('common.edit', 'Edit')}
                            type="button"
                        >
                            <Pencil size={13} />
                        </button>
                        <button
                            className="p-1 rounded hover:bg-red-500/10 text-[var(--text-tertiary)] hover:text-red-600"
                            onClick={() => {
                                onDelete(comment);
                            }}
                            title={t('common.delete', 'Delete')}
                            type="button"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                ) : null}
            </div>
            {editing ? (
                <div className="mt-2">
                    <textarea
                        className="w-full px-2 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/30"
                        onChange={(event) => {
                            onEditDraftChange(event.target.value);
                        }}
                        rows={3}
                        value={editDraft}
                    />
                    <div className="flex justify-end gap-2 mt-2">
                        <button
                            className="px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded"
                            onClick={onStopEditing}
                            type="button"
                        >
                            {t('common.cancel', 'Cancel')}
                        </button>
                        <button
                            className="px-3 py-1 text-xs font-medium text-white bg-[var(--gnosi-blue)] rounded hover:opacity-90 disabled:opacity-50"
                            disabled={!editDraft.trim()}
                            onClick={() => {
                                void onSave(comment.id);
                            }}
                            type="button"
                        >
                            {t('common.save', 'Save')}
                        </button>
                    </div>
                </div>
            ) : (
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                    {comment.body}
                </p>
            )}
        </div>
    );
}
