import { knowledgeDocumentPath } from '../../../shared/routing/vaultRouting';
import './chat-result.css';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { VaultMarkdown } from '../../../shared/editor/VaultMarkdown';
import { createVaultPage } from '../../../shared/api/vault-page-mutations';
import { MemorySources } from './MemorySources';
import { useTranslation } from 'react-i18next';
import { Copy, Reply, RotateCcw, Pencil, ThumbsUp, ThumbsDown, Info, Bookmark, Undo2, ChevronRight, FilePlus2, FileCheck2 } from 'lucide-react';
import { effectiveMessageTimingMs, getTurnId, processingSeconds } from '../model/agentChatMessageUtils';
import { MessageDetails } from './MessageDetails';
import { hasMessageDetails } from './messageDetailsModel';
import { messagePresentation } from './messagePresentation';
import type { ChatMessageRowProps } from './chatMessageRowTypes';

function ActionButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className="gnosi-icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}

export function ChatMessageRow({ message, index: idx,
  notebookId, readOnly, conversationMode, storageIdentity, agentName, isLoading, isRewinding,
  detailsMessageIndex, showTurnRewind, confirmationTitle, setPendingConfirmation, setPendingRewindIndex,
  setDetailsMessageIndex, focusComposerWith, copyMessage, quoteMessage, markMessage,
  submitMessageFeedback, refreshMessageJob, previousUserPrompt, retryMessage
}: ChatMessageRowProps) {
  const { t } = useTranslation();
  const msg = messagePresentation(message);
  const detailsId = useId();
  const expanded = detailsMessageIndex === idx;
  const hasDetails = hasMessageDetails(msg);
  const assistant = msg.role === 'assistant';
  const prompt = !readOnly && assistant ? previousUserPrompt(idx) : '';
  const directUndo = (msg.undo?.available || getTurnId(msg)) ? msg.undo?.run : undefined;
  const [savedResult, setSavedResult] = useState<{ content: string; pageId: string } | null>(null);
  const savedPage = savedResult?.content === msg.content ? savedResult.pageId : '';
  const saveButton = useRef<HTMLButtonElement>(null);
  const savedLink = useRef<HTMLAnchorElement>(null);
  const restoreSaveFocus = useRef(false);
  useEffect(() => {
    if (savedPage && restoreSaveFocus.current) {
      restoreSaveFocus.current = false;
      savedLink.current?.focus();
    }
  }, [savedPage]);
  const saveInFlight = useRef(false);
  const [savingPage, setSavingPage] = useState(false);
  const [failedContent, setFailedContent] = useState<string | null>(null);
  const saveResult = async () => {
    if (saveInFlight.current || savedPage || isLoading) return;
    saveInFlight.current = true;
    setSavingPage(true); setFailedContent(null);
    try {
      const page = await createVaultPage({ title: t('chat.result_title', 'Assistant result'), content: msg.content });
      restoreSaveFocus.current = document.activeElement === saveButton.current;
      setSavedResult({ content: msg.content, pageId: page.id });
    } catch { setFailedContent(msg.content); } finally { saveInFlight.current = false; setSavingPage(false); }
  };
  const toggleDetails = () => { setDetailsMessageIndex(expanded ? null : idx); };
  const details = hasDetails && (
    <div id={detailsId} hidden={!expanded}>
      {expanded && <MessageDetails msg={msg} onJobAction={action => { void refreshMessageJob(idx, action); }} onFocusComposer={focusComposerWith} />}
    </div>
  );
  return (
    <div className={msg.role === 'user' ? 'chat-message chat-message--user' : 'chat-message'}>
        {assistant && hasDetails && <>
            <button type="button" className="chat-message__activity" aria-controls={detailsId} aria-expanded={expanded} onClick={toggleDetails}>
                <ChevronRight size={13} aria-hidden="true" />{t('chat.task_details', 'Task activity')}
            </button>
            {details}
        </>}
        <div className="chat-message__bubble" style={{
            padding: '12px 16px', borderRadius: msg.role === 'user' ? '18px 18px 2px 18px' : '18px 18px 18px 2px',
            backgroundColor: msg.role === 'user' ? 'var(--gnosi-action-bg)' : 'var(--surface-muted)',
            color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
            fontSize: '0.9rem',
            lineHeight: '1.5',
            boxShadow: msg.role === 'user' ? '0 4px 6px -1px rgba(37, 99, 235, 0.2)' : 'none',
            whiteSpace: 'pre-wrap'
        }}>
            {msg.role === 'assistant' ? <div className="chat-result"><VaultMarkdown md={msg.content} allowVaultQueries={false} /></div> : msg.content}
            {msg.role === 'assistant' && <MemorySources value={msg.memory_provenance} readOnly={readOnly} />}
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
        <div className="chat-message__actions">
            <ActionButton label={t('chat.copy_message', 'Copy message')} onClick={() => { void copyMessage(msg.content); }}><Copy /></ActionButton>
            {!readOnly && assistant && msg.content && (savedPage ? (
                <a ref={savedLink} className="gnosi-icon-button chat-message__saved-page" href={knowledgeDocumentPath(savedPage)}
                    aria-label={t('chat.open_result', 'Open saved page')} title={t('chat.open_result', 'Open saved page')}><FileCheck2 /></a>
            ) : (
                <button ref={saveButton} type="button" className="gnosi-icon-button" disabled={isLoading} aria-disabled={savingPage || isLoading}
                    aria-busy={savingPage} onClick={() => { void saveResult(); }}
                    aria-label={t('chat.save_result', 'Save as page')} title={savingPage ? t('chat.result_saving', 'Saving page…') : t('chat.save_result', 'Save as page')}>
                    <FilePlus2 />
                </button>
            ))}
            {!readOnly && <ActionButton label={t('chat.reply_to_message', 'Reply to message')} onClick={() => { quoteMessage(msg); }}><Reply /></ActionButton>}
            {!readOnly && msg.role === 'user' && <ActionButton label={t('chat.edit_message', 'Edit and resend')} onClick={() => { focusComposerWith(msg.content); }}><Pencil /></ActionButton>}
            {prompt && <ActionButton label={msg.retryable ? t('chat.retry_response', 'Retry response') : t('chat.regenerate_message', 'Regenerate response')}
                disabled={isLoading && msg.retryable} onClick={() => { if (msg.retryable) retryMessage(idx); else focusComposerWith(prompt); }}><RotateCcw /></ActionButton>}
            {assistant && <>
                <ActionButton label={t('chat.helpful_response', 'Helpful response')} aria-pressed={msg.feedback === 'up'} onClick={() => { void submitMessageFeedback(idx, 'up'); }}><ThumbsUp /></ActionButton>
                <ActionButton label={t('chat.unhelpful_response', 'Unhelpful response')} aria-pressed={msg.feedback === 'down'} onClick={() => { void submitMessageFeedback(idx, 'down'); }}><ThumbsDown /></ActionButton>
                <ActionButton label={t('chat.save_message', 'Bookmark message')} aria-pressed={msg.saved} onClick={() => { markMessage(idx, 'saved', !msg.saved); }}><Bookmark fill={msg.saved ? 'currentColor' : 'none'} /></ActionButton>
            </>}
            {!readOnly && conversationMode !== 'shared' && (assistant || msg.role === 'user') && (directUndo || showTurnRewind) && (
                <ActionButton label={directUndo ? t('chat.undo_last_action', 'Undo last action') : t('chat.rewind_from_message', 'Undo from this message')}
                    disabled={isLoading || isRewinding} onClick={() => { if (directUndo) { void directUndo(); } else setPendingRewindIndex(idx); }}><Undo2 /></ActionButton>
            )}
            {!assistant && hasDetails && <ActionButton label={t('chat.message_details', 'Message details')} aria-controls={detailsId} aria-expanded={expanded} onClick={toggleDetails}><Info /></ActionButton>}
        </div>
        {!assistant && details}
        {!readOnly && assistant && <span className="sr-only" role="status">{savedPage ? t('chat.result_saved', 'Page saved') : ''}</span>}
        {!readOnly && assistant && failedContent === msg.content && <span className="chat-message__save-error" role="alert">{t('chat.save_result_error', 'Could not save the result. Review pages before retrying.')}</span>}
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
