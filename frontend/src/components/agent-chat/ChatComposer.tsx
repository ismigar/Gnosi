import { useTranslation } from 'react-i18next';
import { Send, Paperclip, AtSign, Blocks, Plus, Archive } from 'lucide-react';
import { chatScrollDeltaForComposerKey } from '../agentChatKeyboardUtils';
import { CHAT_ATTACHMENT_ACCEPT } from './composerModel';
import type { ChatComposerProps } from './chatComposerTypes';

export function ChatComposer({
  readOnly, embedded, isLoading, agentHasModel, isUploadingAttachment,
  showMentionMenu, showSessionsView, inputValue, inputRef, fileInputRef,
  messagesContainerRef, attachments, contextRefs, mentionResults, setInputValue,
  setShowSessionsView, handleSubmit, handlePickAttachment, handleAttachmentInputChange,
  removeAttachment, applyMention, createNewSession
}: ChatComposerProps) {
  const { t } = useTranslation();
  const autoResizeInput = () => {
    if (!inputRef.current) return;
    inputRef.current.style.height = '0px';
    inputRef.current.style.height = `${String(inputRef.current.scrollHeight)}px`;
  };
  return (
    readOnly ? (
        <div role="status" style={{ padding: '12px 16px', borderTop: '1px solid var(--settings-border, #e5e7eb)', background: 'var(--settings-sidebar-bg, #f3f4f6)', color: 'var(--text-secondary)', fontSize: '0.78rem', textAlign: 'center' }}>
            {t('notebooks.chat_read_only', 'You can read this conversation. An editor role is required to send messages.')}
        </div>
    ) : <div style={{ padding: '10px 10px 8px 10px', borderTop: '1px solid var(--settings-border, #e5e7eb)', background: 'var(--bg-primary)' }}>
        <div style={{ position: 'relative' }}>
            <form onSubmit={(event) => { void handleSubmit(event); }} style={{
                display: 'flex', gap: '8px', alignItems: 'flex-end',
                background: 'var(--settings-input-bg, #f9fafb)', padding: '6px',
                borderRadius: '16px', border: '1px solid var(--settings-border, #e5e7eb)'
            }}>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={CHAT_ATTACHMENT_ACCEPT}
                    style={{ display: 'none' }}
                    onChange={(event) => { void handleAttachmentInputChange(event); }}
                />
                {!embedded && <button type="button" onClick={handlePickAttachment} disabled={isUploadingAttachment} aria-label={t('chat.attach_files', "Attach files")} title={t('chat.attach_files', "Attach files")} style={{ background: 'none', border: 'none', cursor: isUploadingAttachment ? 'default' : 'pointer', color: 'var(--text-secondary)', padding: '8px', opacity: isUploadingAttachment ? 0.6 : 1 }}>
                    <Paperclip size={18} />
                </button>}
                <textarea
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => {
                        setInputValue(e.target.value);
                        requestAnimationFrame(autoResizeInput);
                    }}
                    onKeyDown={(e) => {
                        const scrollDelta = chatScrollDeltaForComposerKey({
                            key: e.key,
                            value: e.currentTarget.value,
                            altKey: e.altKey,
                            ctrlKey: e.ctrlKey,
                            metaKey: e.metaKey,
                            shiftKey: e.shiftKey,
                        });
                        if (scrollDelta) {
                            e.preventDefault();
                            messagesContainerRef.current?.scrollBy({
                                top: scrollDelta,
                                behavior: 'smooth',
                            });
                            return;
                        }
                        if (e.key === 'Enter' && e.shiftKey) {
                            // Keep newline behavior and avoid parent-level Enter handlers.
                            e.stopPropagation();
                            return;
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleSubmit(e);
                        }
                    }}
                    onInput={() => requestAnimationFrame(autoResizeInput)}
                    placeholder={embedded
                        ? t('notebooks.chat_placeholder', 'Ask a question about these sources...')
                        : t('chat.input_placeholder', "Write a message... (use @ to mention)")}
                    style={{
                        flex: 1, padding: '8px', border: 'none', outline: 'none',
                        background: 'transparent', color: 'var(--text-primary)',
                        fontSize: '0.9rem', resize: 'none',
                        minHeight: '24px',
                        overflow: 'hidden'
                    }}
                    rows={1}
                />
                <button
                    type="submit"
                    disabled={isLoading || !agentHasModel || (!inputValue.trim() && attachments.length === 0)}
                    aria-label={t('chat.send_message', "Send message")}
                    title={agentHasModel ? t('chat.send_message', "Send message") : t('chat.model_required', 'Configure this agent before sending a message')}
                    style={{
                        width: '36px', height: '36px', borderRadius: '12px',
                        backgroundColor: agentHasModel && (inputValue.trim() || attachments.length > 0) ? 'var(--gnosi-blue, #2563eb)' : '#e5e7eb',
                        color: 'white', border: 'none', cursor: agentHasModel ? 'pointer' : 'not-allowed',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s'
                    }}
                >
                    <Send size={18} />
                </button>
            </form>

            {contextRefs.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                    {contextRefs.map(ref => (
                        <span key={ref.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '999px', border: '1px solid var(--settings-border, #e5e7eb)', padding: '3px 8px', fontSize: '0.68rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg, #f3f4f6)' }}>
                            <Blocks size={11} />
                            {t('chat.current_source_context', '{{source}} context', { source: ref.label })}
                        </span>
                    ))}
                </div>
            )}

            {attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                    {attachments.map((item) => (
                        <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '999px', border: '1px solid var(--settings-border, #e5e7eb)', padding: '3px 8px', fontSize: '0.68rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg, #f3f4f6)' }}>
                            <span style={{ maxWidth: '170px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                            <button type="button" onClick={() => { removeAttachment(item.id); }} aria-label={t('chat.remove_attachment_aria', "Remove attachment {{name}}", { name: item.name || '' }).trim()} title={t('chat.remove_attachment_title', "Remove attachment")} style={{ border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, lineHeight: 1 }}>x</button>
                        </span>
                    ))}
                </div>
            )}

            {showMentionMenu && mentionResults.length > 0 && (
                <div style={{
                    position: 'absolute',
                    left: '40px',
                    right: '46px',
                    bottom: '56px',
                    zIndex: 5,
                    background: 'var(--settings-bg, #fff)',
                    border: '1px solid var(--settings-border, #e5e7eb)',
                    borderRadius: '10px',
                    boxShadow: '0 10px 20px rgba(0,0,0,0.12)',
                    maxHeight: '180px',
                    overflowY: 'auto',
                    padding: '6px'
                }}>
                    {mentionResults.map((item) => (
                        <button
                            key={`${item.type}:${item.id}`}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                applyMention(item);
                            }}
                            style={{
                                width: '100%',
                                border: 'none',
                                borderRadius: '8px',
                                background: 'transparent',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                padding: '7px 8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '8px'
                            }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                                <AtSign size={13} />
                                <span style={{ fontSize: '0.78rem' }}>{item.label}</span>
                            </span>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>{item.subtitle}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>

        {!embedded && <div style={{ marginTop: '6px', padding: '0 2px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <button onClick={() => { void createNewSession(); }} disabled={isLoading} title={t('chat.new_session', "New session")} aria-label={t('chat.new_session', "New session")} style={{ width: '26px', height: '26px', borderRadius: '13px', border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', cursor: isLoading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Plus size={12} />
                </button>
                <button onClick={() => { setShowSessionsView((v) => !v); }} title={t('chat.sessions', 'Sessions')} aria-label={t('chat.sessions', 'Sessions')} style={{ width: '26px', height: '26px', borderRadius: '13px', border: '1px solid var(--settings-border, #e5e7eb)', background: showSessionsView ? 'var(--settings-sidebar-bg, #f3f4f6)' : 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Archive size={12} />
                </button>
            </div>
        </div>}
    </div>
  );
}
