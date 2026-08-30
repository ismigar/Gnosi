import { Brain, Sparkles } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import { ConfirmationReview } from './ConfirmationReview';
import { ChatComposer } from './ChatComposer';
import { ChatMessageRow } from './ChatMessageRow';
import { ChatHeader } from './ChatHeader';
import { ChatDock } from './ChatDock';
import { ChatSessionList } from './ChatSessionList';
import type { useAgentChatController } from './useAgentChatController';

export function ChatPanelView({ controller }: { controller: ReturnType<typeof useAgentChatController> }) {
    const {
        t, embedded, readOnly, notebookId, conversationMode, storageIdentity, contextRefs,
        isOpen, isDockOpen, agentIcon, setIsDockOpen, setIsOpen, isMinimized, handleChatKeyDown,
        isLoading, runtimeLimited, agentHasModel, agentName, selectedAgentId, runtimeStatusLabel,
        agentModel, runtimeStatusHelp, agentList, archiveCurrentSession, setIsMinimized,
        setSelectedAgentId, setShowSessionsView, messagesContainerRef, showSessionsView,
        sortedSessions, selectSession, deleteSessionById, messages, isRewinding, detailsMessageIndex,
        confirmationTitle, confirmationSummary, setPendingConfirmation, setPendingRewindIndex,
        setDetailsMessageIndex, focusComposerWith, copyMessage, quoteMessage, markMessage,
        submitMessageFeedback, refreshMessageJob, previousUserPrompt, retryMessage,
        processingPhase, processingElapsedSeconds, cancelResponse, messagesEndRef,
        isUploadingAttachment, showMentionMenu, inputValue, inputRef, fileInputRef, attachments,
        mentionResults, setInputValue, handleSubmit, handlePickAttachment,
        handleAttachmentInputChange, removeAttachment, applyMention, createNewSession,
        pendingConfirmation, cancelPendingAction, confirmPendingAction, pendingRewindIndex,
        confirmConversationRewind
    } = controller;
    if (!isOpen && !embedded) {
        return <ChatDock isDockOpen={isDockOpen} agentIcon={agentIcon} setIsDockOpen={setIsDockOpen} setIsOpen={setIsOpen} />;
    }

    return (
        <div
            className={embedded ? 'gnosi-embedded-chat' : 'gnosi-floating-panel gnosi-floating-panel--chat'}
            tabIndex={0}
            onKeyDown={handleChatKeyDown}
            style={{
            position: embedded ? 'relative' : 'fixed',
            bottom: embedded ? 'auto' : 'max(16px, env(safe-area-inset-bottom))',
            right: embedded ? 'auto' : 'max(16px, env(safe-area-inset-right))',
            zIndex: embedded ? 'auto' : 'var(--z-floating)',
            width: embedded ? '100%' : (isMinimized ? '200px' : 'min(400px, calc(100vw - 2rem))'),
            height: embedded ? '100%' : (isMinimized ? '50px' : '600px'),
            minHeight: embedded ? '420px' : undefined,
            maxHeight: embedded ? 'none' : 'calc(100vh - 100px)',
            backgroundColor: 'var(--bg-primary, white)',
            borderRadius: embedded ? '14px' : '20px', boxShadow: embedded ? 'none' : '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            border: '1px solid var(--settings-border, #e5e7eb)',
            transition: 'all 0.3s ease-in-out'
            }}
        >
            <ChatHeader embedded={embedded} isMinimized={isMinimized} isLoading={isLoading} runtimeLimited={runtimeLimited} agentHasModel={agentHasModel} agentIcon={agentIcon} agentName={agentName} selectedAgentId={selectedAgentId} runtimeStatusLabel={runtimeStatusLabel} agentModel={agentModel} runtimeStatusHelp={runtimeStatusHelp} agentList={agentList} archiveCurrentSession={archiveCurrentSession} setIsMinimized={setIsMinimized} setSelectedAgentId={setSelectedAgentId} setShowSessionsView={setShowSessionsView} setIsOpen={setIsOpen} />

            {!isMinimized && (
                <>
                    {/* Missatges */}
                    <div ref={messagesContainerRef} style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {showSessionsView && (
                            <ChatSessionList sortedSessions={sortedSessions} setShowSessionsView={setShowSessionsView} selectSession={(id) => { void selectSession(id); }} deleteSessionById={(id) => { void deleteSessionById(id); }} />
                        )}

                        {!showSessionsView && messages.length === 0 && (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>
                                <div style={{ fontSize: '3rem', marginBottom: '16px', color: 'var(--gnosi-blue)' }}>
                                    <Brain size={64} strokeWidth={1.5} />
                                </div>
                                <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>{t('chat.empty_title', "How can I help you today?")}</h4>
                                <p style={{ fontSize: '0.85rem', margin: 0 }}>{t('chat.empty_subtitle', "I can analyze your Vault, manage your calendar, or write code for you.")}</p>
                            </div>
                        )}
                        {!showSessionsView && messages.map((msg, idx) => (
                            <ChatMessageRow key={idx} message={msg} index={idx}
                                notebookId={notebookId}
                                readOnly={readOnly}
                                conversationMode={conversationMode}
                                storageIdentity={storageIdentity}
                                agentName={agentName}
                                isLoading={isLoading}
                                isRewinding={isRewinding}
                                detailsMessageIndex={detailsMessageIndex}
                                confirmationTitle={confirmationTitle}
                                setPendingConfirmation={setPendingConfirmation}
                                setPendingRewindIndex={setPendingRewindIndex}
                                setDetailsMessageIndex={setDetailsMessageIndex}
                                focusComposerWith={focusComposerWith}
                                copyMessage={copyMessage}
                                quoteMessage={quoteMessage}
                                markMessage={markMessage}
                                submitMessageFeedback={submitMessageFeedback}
                                refreshMessageJob={refreshMessageJob}
                                previousUserPrompt={previousUserPrompt}
                                retryMessage={retryMessage}
                            />
                        ))}
                        {!showSessionsView && isLoading && (
                            <div style={{ alignSelf: 'flex-start', display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                <Sparkles size={14} className="spin-slow" /> {t('chat.processing_phase_label', '{{phase}} · {{count}} s', {
                                    phase: t(`chat.processing_phase.${processingPhase}`, processingPhase),
                                    count: processingElapsedSeconds,
                                })}
                                <button
                                    type="button"
                                    onClick={cancelResponse}
                                    style={{ border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.76rem' }}
                                >
                                    {t('chat.cancel_response', 'Cancel')}
                                </button>
                            </div>
                        )}
                        {!showSessionsView && <div ref={messagesEndRef} />}
                    </div>

                    {/* Input Area */}
                    <ChatComposer
                        readOnly={readOnly}
                        embedded={embedded}
                        isLoading={isLoading}
                        agentHasModel={agentHasModel}
                        isUploadingAttachment={isUploadingAttachment}
                        showMentionMenu={showMentionMenu}
                        showSessionsView={showSessionsView}
                        inputValue={inputValue}
                        inputRef={inputRef}
                        fileInputRef={fileInputRef}
                        messagesContainerRef={messagesContainerRef}
                        attachments={attachments}
                        contextRefs={contextRefs}
                        mentionResults={mentionResults}
                        setInputValue={setInputValue}
                        setShowSessionsView={setShowSessionsView}
                        handleSubmit={handleSubmit}
                        handlePickAttachment={handlePickAttachment}
                        handleAttachmentInputChange={handleAttachmentInputChange}
                        removeAttachment={removeAttachment}
                        applyMention={applyMention}
                        createNewSession={createNewSession}
                    />
                </>
            )}
            <ConfirmModal
                isOpen={Boolean(pendingConfirmation)}
                onClose={() => { void cancelPendingAction(); }}
                onConfirm={confirmPendingAction}
                title={pendingConfirmation ? confirmationTitle(pendingConfirmation) : ''}
                message={pendingConfirmation ? <ConfirmationReview confirmation={pendingConfirmation} summary={confirmationSummary(pendingConfirmation)} /> : ''}
                confirmText={t('chat.confirmations.confirm', 'Confirm and execute')}
                cancelText={t('chat.confirmations.cancel', 'Cancel action')}
                isDestructive={pendingConfirmation?.destructive !== false}
                confirmOnEnter={false}
                autofocusConfirm={false}
                requireAcknowledgement
                acknowledgementLabel={t('chat.confirmations.acknowledgement', 'I have reviewed this action and want to continue.')}
            />
            <ConfirmModal
                isOpen={pendingRewindIndex !== null}
                onClose={() => { if (!isRewinding) setPendingRewindIndex(null); }}
                onConfirm={confirmConversationRewind}
                title={t('chat.rewind_title', 'Undo conversation from here?')}
                message={t(
                    'chat.rewind_warning',
                    'This removes this turn and every later turn from the conversation memory. Completed external actions are not reversed.',
                )}
                confirmText={t('chat.rewind_confirm', 'Undo messages')}
                cancelText={t('common.cancel', 'Cancel')}
                isDestructive
                confirmOnEnter={false}
                autofocusConfirm={false}
            />
        </div>
    );
}
