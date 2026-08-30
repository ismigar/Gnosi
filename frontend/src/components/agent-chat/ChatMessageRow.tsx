import { useTranslation } from 'react-i18next';
import { Copy, Reply, RotateCcw, Pencil, ThumbsUp, ThumbsDown, Info, Bookmark, Undo2 } from 'lucide-react';
import { effectiveMessageTimingMs, getTurnId, processingSeconds } from '../agentChatMessageUtils';
import { MessageDetails } from './MessageDetails';
import { messagePresentation } from './messagePresentation';
import type { ChatMessageRowProps } from './chatMessageRowTypes';

export function ChatMessageRow({ message, index: idx,
  notebookId, readOnly, conversationMode, storageIdentity, agentName, isLoading, isRewinding,
  detailsMessageIndex, confirmationTitle, setPendingConfirmation, setPendingRewindIndex,
  setDetailsMessageIndex, focusComposerWith, copyMessage, quoteMessage, markMessage,
  submitMessageFeedback, refreshMessageJob, previousUserPrompt, retryMessage
}: ChatMessageRowProps) {
  const { t } = useTranslation();
  const msg = messagePresentation(message);
  return (
    <div style={{
        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
    }}>
        <div style={{
            padding: '12px 16px', borderRadius: msg.role === 'user' ? '18px 18px 2px 18px' : '18px 18px 18px 2px',
            backgroundColor: msg.role === 'user' ? 'var(--gnosi-blue, #2563eb)' : 'var(--settings-sidebar-bg, #f3f4f6)',
            color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
            fontSize: '0.9rem',
            lineHeight: '1.5',
            boxShadow: msg.role === 'user' ? '0 4px 6px -1px rgba(37, 99, 235, 0.2)' : 'none',
            whiteSpace: 'pre-wrap'
        }}>
            {msg.content}
            {msg.role === 'assistant' && msg.citations && msg.citations.claims.length > 0 && (
                <details open={notebookId ? true : undefined} style={{ marginTop: '10px', whiteSpace: 'normal' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--gnosi-blue, #2563eb)', fontSize: '0.74rem', fontWeight: 600 }}>
                        {t('chat.citations_summary', '{{claims}} grounded claim(s) · {{sources}} source(s)', {
                            claims: msg.citations.claim_count,
                            sources: msg.citations.source_count,
                        })}
                    </summary>
                    <div style={{ marginTop: '7px', display: 'flex', flexDirection: 'column', gap: '7px', maxHeight: '220px', overflowY: 'auto' }}>
                        {msg.citations.claims.map((claim) => {
                            const citedSources = claim.citation_ids
                                .map(citationId => msg.citations?.sources.find(source => source.citation_id === citationId))
                                .filter(source => source !== undefined);
                            return (
                                <div key={claim.claim_id} style={{ paddingLeft: '8px', borderLeft: '2px solid var(--border-primary)', fontSize: '0.7rem' }}>
                                    <div style={{ color: 'var(--text-secondary)' }}>{claim.text}</div>
                                    <div style={{ marginTop: '3px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                        {citedSources.map(source => source.href ? (
                                            <a
                                                key={source.citation_id}
                                                href={source.href}
                                                target={source.href.startsWith('http') ? '_blank' : undefined}
                                                rel={source.href.startsWith('http') ? 'noreferrer' : undefined}
                                                aria-label={notebookId
                                                    ? t('notebooks.open_citation', 'Open the cited evidence in its source: {{source}}', { source: source.title })
                                                    : undefined}
                                                title={notebookId
                                                    ? t('notebooks.open_citation', 'Open the cited evidence in its source: {{source}}', { source: source.title })
                                                    : undefined}
                                                style={{ color: 'var(--gnosi-blue, #2563eb)', textDecoration: 'underline' }}
                                            >
                                                {source.title}{source.version_status === 'exact'
                                                    ? ` · ${t('chat.citation_versioned', 'version verified')}`
                                                    : ''}
                                            </a>
                                        ) : (
                                            <span key={source.citation_id} title={t('chat.citation_link_unavailable', 'This evidence has no direct link.')}>
                                                {source.title}{source.version_status === 'exact'
                                                    ? ` · ${t('chat.citation_versioned', 'version verified')}`
                                                    : ''}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </details>
            )}
            {msg.confirmation && (
                <div style={{
                    marginTop: '10px',
                    padding: '10px',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '10px',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                }}>
                    <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>
                        {confirmationTitle(msg.confirmation)}
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        {t(
                            `chat.confirmations.status.${msg.confirmation.status || 'pending'}`,
                            msg.confirmation.status || 'pending',
                        )}
                    </div>
                    {msg.confirmation.status === 'pending' && (
                        <button
                            type="button"
                            onClick={() => { if (msg.confirmation) setPendingConfirmation(msg.confirmation); }}
                            style={{
                                marginTop: '8px',
                                border: 'none',
                                borderRadius: '8px',
                                padding: '6px 10px',
                                background: 'var(--status-error)',
                                color: 'white',
                                cursor: 'pointer',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                            }}
                        >
                            {t('chat.confirmations.review', 'Review and confirm')}
                        </button>
                    )}
                </div>
            )}
            {msg.attachments.length > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {msg.attachments.map((item, idx2) => (
                        <div key={`${item.name || 'file'}-${String(idx2)}`} style={{ fontSize: '0.76rem', opacity: 0.95 }}>
                            📎 {item.url ? (
                                <a href={item.url} target="_blank" rel="noreferrer" style={{ color: msg.role === 'user' ? 'white' : 'var(--gnosi-blue, #2563eb)', textDecoration: 'underline' }}>
                                    {item.name || item.url}
                                </a>
                            ) : (
                                item.name || t('chat.attachment_fallback_name', "file")
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px', padding: '0 2px', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <button type="button" onClick={() => { void copyMessage(msg.content); }} aria-label={t('chat.copy_message', 'Copy message')} title={t('chat.copy_message', 'Copy message')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Copy size={13} /></button>
            {!readOnly && <button type="button" onClick={() => { quoteMessage(msg); }} aria-label={t('chat.reply_to_message', 'Reply to message')} title={t('chat.reply_to_message', 'Reply to message')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Reply size={13} /></button>}
            {!readOnly && msg.role === 'user' && (
                <button type="button" onClick={() => { focusComposerWith(msg.content || ''); }} aria-label={t('chat.edit_message', 'Edit and resend')} title={t('chat.edit_message', 'Edit and resend')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Pencil size={13} /></button>
            )}
            {!readOnly && msg.role === 'assistant' && previousUserPrompt(idx) && (
                <button type="button" onClick={() => { focusComposerWith(previousUserPrompt(idx)); }} aria-label={t('chat.regenerate_message', 'Regenerate response')} title={t('chat.regenerate_message', 'Regenerate response')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><RotateCcw size={13} /></button>
            )}
            {!readOnly && msg.role === 'assistant' && msg.retryable && previousUserPrompt(idx) && (
                <button type="button" onClick={() => { retryMessage(idx); }} aria-label={t('chat.retry_response', 'Retry response')} title={t('chat.retry_response', 'Retry response')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: isLoading ? 'default' : 'pointer', padding: '3px', opacity: isLoading ? 0.45 : 1 }} disabled={isLoading}><RotateCcw size={13} /></button>
            )}
            {msg.role === 'assistant' && (
                <>
                    <button type="button" onClick={() => { void submitMessageFeedback(idx, 'up'); }} aria-label={t('chat.helpful_response', 'Helpful response')} title={t('chat.helpful_response', 'Helpful response')} aria-pressed={msg.feedback === 'up'} style={{ background: 'none', border: 'none', color: msg.feedback === 'up' ? 'var(--gnosi-blue, #2563eb)' : 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><ThumbsUp size={13} /></button>
                    <button type="button" onClick={() => { void submitMessageFeedback(idx, 'down'); }} aria-label={t('chat.unhelpful_response', 'Unhelpful response')} title={t('chat.unhelpful_response', 'Unhelpful response')} aria-pressed={msg.feedback === 'down'} style={{ background: 'none', border: 'none', color: msg.feedback === 'down' ? 'var(--status-error, #dc2626)' : 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><ThumbsDown size={13} /></button>
                    <button type="button" onClick={() => { markMessage(idx, 'saved', !msg.saved); }} aria-label={t('chat.save_message', 'Save message')} title={t('chat.save_message', 'Save message')} aria-pressed={msg.saved} style={{ background: 'none', border: 'none', color: msg.saved ? 'var(--gnosi-blue, #2563eb)' : 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Bookmark size={13} fill={msg.saved ? 'currentColor' : 'none'} /></button>
                </>
            )}
            {!readOnly && conversationMode !== 'shared' && (msg.role === 'assistant' || msg.role === 'user') && (
                msg.undo?.available
                || Boolean(getTurnId(msg))
            ) && (() => {
                const undo = msg.undo;
                const hasDirectUndo = typeof undo?.run === 'function';
                const undoHint = hasDirectUndo
                    ? t('chat.undo_last_action', 'Undo last action')
                    : t('chat.rewind_from_message', 'Undo from this message');
                return (
                    <button
                        type="button"
                        onClick={() => {
                            if (hasDirectUndo) { void undo.run(); return; }
                            setPendingRewindIndex(idx);
                        }}
                        aria-label={undoHint}
                        title={undoHint}
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: isLoading || isRewinding ? 'default' : 'pointer', padding: '3px', opacity: isLoading || isRewinding ? 0.45 : 1 }}
                        disabled={isLoading || isRewinding}
                    >
                        <Undo2 size={13} />
                    </button>
                );
            })()}
            <button type="button" onClick={() => { setDetailsMessageIndex(detailsMessageIndex === idx ? null : idx); }} aria-label={t('chat.message_details', 'Message details')} title={t('chat.message_details', 'Message details')} aria-expanded={detailsMessageIndex === idx} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Info size={13} /></button>
        </div>
        {detailsMessageIndex === idx && (
            <MessageDetails msg={msg} onJobAction={(action) => { void refreshMessageJob(idx, action); }} onFocusComposer={focusComposerWith} />
        )}
        {(() => {
            const responseSeconds = msg.role === 'user'
                ? null
                : processingSeconds(effectiveMessageTimingMs(msg));
            return (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', padding: '0 4px' }}>
                    {msg.role === 'user'
                        ? (
                            msg.author_user_id && msg.author_user_id !== storageIdentity
                                ? t('notebooks.member_message', 'Member {{member}}', { member: msg.author_user_id })
                                : t('chat.you', "You")
                        )
                        : `${agentName}${msg.llm?.model ? ` - ${msg.llm.model}` : ''}`}
                    {msg.role !== 'user' && responseSeconds !== null
                        ? ` · ${t('chat.processing_seconds', '{{count}} s', { count: responseSeconds })}`
                        : ''}
                </span>
            );
        })()}
    </div>
  );
}
