import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Check,
  MessageSquare,
  MessageSquarePlus,
  Trash2,
  X,
} from 'lucide-react';

import type { VaultInlineComment } from '../../../../shared/api/vault-comments';
import { browserDocumentBody } from '../../../../shared/platform/browser-events';


export interface FloatingPosition {
  readonly left: number;
  readonly top: number;
}


export interface ComposerPosition extends FloatingPosition {
  readonly blockId: string;
  readonly quote: string;
}


interface InlineCommentsViewProps {
  readonly buttonPosition: FloatingPosition | null;
  readonly canComment: boolean;
  readonly comments: readonly VaultInlineComment[];
  readonly composeRef: RefObject<HTMLTextAreaElement | null>;
  readonly composer: ComposerPosition | null;
  readonly draft: string;
  readonly onCancelCompose: () => void;
  readonly onClosePanel: () => void;
  readonly onComposerKeyDown: (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => void;
  readonly onDraftChange: (value: string) => void;
  readonly onGoTo: (comment: VaultInlineComment) => void;
  readonly onRemove: (comment: VaultInlineComment) => void;
  readonly onResolve: (comment: VaultInlineComment) => void;
  readonly onStartCompose: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly onSubmit: () => void;
  readonly panelOpen: boolean;
}


export function InlineCommentsView({
  buttonPosition,
  canComment,
  comments,
  composeRef,
  composer,
  draft,
  onCancelCompose,
  onClosePanel,
  onComposerKeyDown,
  onDraftChange,
  onGoTo,
  onRemove,
  onResolve,
  onStartCompose,
  onSubmit,
  panelOpen,
}: InlineCommentsViewProps) {
  const { t } = useTranslation();
  const openComments = comments.filter((comment) => !comment.resolved);
  const portalTarget = browserDocumentBody();

  return (
    <>
      {canComment && buttonPosition && createPortal(
        <button
          className="flex items-center gap-1 rounded-full bg-[var(--gnosi-primary)] px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:opacity-90"
          data-gnosi-portal="comment-btn"
          onMouseDown={onStartCompose}
          style={{
            left: buttonPosition.left,
            position: 'fixed',
            top: buttonPosition.top,
            zIndex: 'var(--z-popover)',
          }}
          type="button"
        >
          <MessageSquarePlus size={14} /> {t('inline_comments.add', 'Comment')}
        </button>,
        portalTarget,
      )}

      {canComment && composer && createPortal(
        <div
          className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2.5 shadow-xl"
          data-gnosi-portal="comment-compose"
          style={{
            left: composer.left,
            position: 'fixed',
            top: composer.top,
            width: 300,
            zIndex: 'var(--z-popover)',
          }}
        >
          <div className="mb-2 line-clamp-2 border-l-2 border-[var(--gnosi-primary)] pl-2 text-xs italic text-[var(--text-tertiary)]">
            «{composer.quote}»
          </div>
          <textarea
            className="h-20 w-full resize-y rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
            onChange={(event) => {
              onDraftChange(event.target.value);
            }}
            onKeyDown={onComposerKeyDown}
            placeholder={t('inline_comments.placeholder', 'Write a comment…')}
            ref={composeRef}
            value={draft}
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              className="rounded px-2 py-1 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
              onMouseDown={(event) => {
                event.preventDefault();
                onCancelCompose();
              }}
              type="button"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              className="rounded bg-[var(--gnosi-primary)] px-2.5 py-1 text-xs font-medium text-white"
              onMouseDown={(event) => {
                event.preventDefault();
                onSubmit();
              }}
              type="button"
            >
              {t('inline_comments.add', 'Comment')}
            </button>
          </div>
        </div>,
        portalTarget,
      )}

      {panelOpen && createPortal(
        <div className="fixed right-0 top-0 z-[140] flex h-full w-80 flex-col border-l border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <MessageSquare size={16} />
              {t('inline_comments.title', 'Comments ({{count}})', {
                count: openComments.length,
              })}
            </span>
            <button
              aria-label={t('common.close', 'Close')}
              className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
              onClick={onClosePanel}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-3">
            {comments.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
                {canComment
                  ? t(
                    'inline_comments.empty',
                    'Select text and click “Comment” to add one.',
                  )
                  : t('comments.empty', 'No comments yet')}
              </div>
            ) : comments.map((comment) => (
              <div
                className={`mb-2 rounded-lg border p-2.5 ${comment.resolved
                  ? 'border-[var(--border-primary)] opacity-60'
                  : 'border-[var(--border-primary)]'}`}
                key={comment.id}
              >
                {comment.quote && (
                  <button
                    className="mb-1 block w-full border-l-2 border-[var(--gnosi-primary)] pl-2 text-left text-xs italic text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                    onClick={() => {
                      onGoTo(comment);
                    }}
                    type="button"
                  >
                    «{comment.quote}»
                  </button>
                )}
                <div className={`text-sm text-[var(--text-primary)] ${comment.resolved
                  ? 'line-through'
                  : ''}`}
                >
                  {comment.comment}
                </div>
                {canComment && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-primary)]"
                      onClick={() => {
                        onResolve(comment);
                      }}
                      title={comment.resolved
                        ? t('inline_comments.reopen', 'Reopen')
                        : t('inline_comments.resolve', 'Resolve')}
                      type="button"
                    >
                      <Check size={12} />
                      {comment.resolved
                        ? t('inline_comments.reopen', 'Reopen')
                        : t('inline_comments.resolve', 'Resolve')}
                    </button>
                    <button
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-danger,#dc2626)]"
                      onClick={() => {
                        onRemove(comment);
                      }}
                      title={t('inline_comments.delete', 'Delete')}
                      type="button"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>,
        portalTarget,
      )}
    </>
  );
}
