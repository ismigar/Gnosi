import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Sparkles } from 'lucide-react';
import { useExclusiveFloatingPanel } from '../hooks/useExclusiveFloatingPanel';
import { useFloatingActionDock } from '../hooks/useFloatingActionDock';
import ConfirmModal from './ConfirmModal';
import {
    agentChatStorageScope,
} from './agentConfirmationUtils';
import { chatScrollDeltaForComposerKey } from './agentChatKeyboardUtils';
import { deriveAgentRuntimeStatus } from './agentRuntimeStatus';
import { readChatStorage, scopedChatStorageKey } from './agent-chat/chatPersistence';
import { useChatSessionPersistence } from './agent-chat/useChatSessionPersistence';
import { useNotebookConversation } from './agent-chat/useNotebookConversation';
import { useChatSessionSelection, useSessionMessageBinding } from './agent-chat/useChatSessionSelection';
import { ConfirmationReview } from './agent-chat/ConfirmationReview';
import { useAgentConfirmations } from './agent-chat/useAgentConfirmations';
import { cancelChatStream } from '../shared/api/chat-streaming';
import { useChatMentions } from './agent-chat/useChatMentions';
import { useChatConfiguration } from './agent-chat/useChatConfiguration';
import { useChatAttachments } from './agent-chat/useChatAttachments';
import { ChatComposer } from './agent-chat/ChatComposer';
import { ChatMessageRow } from './agent-chat/ChatMessageRow';
import { ChatHeader } from './agent-chat/ChatHeader';
import { ChatDock } from './agent-chat/ChatDock';
import { ChatSessionList } from './agent-chat/ChatSessionList';
import { useChatMessageActions } from './agent-chat/useChatMessageActions';
import { useChatRewind } from './agent-chat/useChatRewind';
import { logChatError } from './agent-chat/chatDiagnostics';
import { submitChatTurn } from './agent-chat/submitChatTurn';

const AgentChat = ({
    storageIdentity = '',
    contextRefs = [],
    embedded = false,
    forcedSessionId = '',
    forcedAgentId = '',
    notebookId = '',
    conversationMode = 'private_member',
    readOnly = false,
}) => {
    const { t } = useTranslation();
    const defaultSessionTitle = t('chat.default_session_title', 'New conversation');
    const [isOpen, setIsOpen] = useState(embedded);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState('');
    const [selectedAgentId, setSelectedAgentId] = useState('gnosy');
    const [isMinimized, setIsMinimized] = useState(false);
    const [chatSessions, setChatSessions] = useState([]);
    const [sessionsHydrated, setSessionsHydrated] = useState(false);
    const [hydratedStorageScope, setHydratedStorageScope] = useState('');
    const [showSessionsView, setShowSessionsView] = useState(false);
    const [selectedMentions, setSelectedMentions] = useState([]);
    const [attachments, setAttachments] = useState([]);
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
    const [pendingConfirmation, setPendingConfirmation] = useState(null);
    const [agentRuntime, setAgentRuntime] = useState(null);
    const [detailsMessageIndex, setDetailsMessageIndex] = useState(null);
    const [processingElapsedSeconds, setProcessingElapsedSeconds] = useState(0);
    const [processingPhase, setProcessingPhase] = useState('routing');
    const [pendingRewindIndex, setPendingRewindIndex] = useState(null);
    const [isRewinding, setIsRewinding] = useState(false);
    const [isDockOpen, setIsDockOpen] = useFloatingActionDock();
    useExclusiveFloatingPanel('chat', !embedded && isOpen, setIsOpen);

    // Ref to scroll to the bottom
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const requestAbortRef = useRef(null);
    const activeStreamRef = useRef('');
    const processingStartedAtRef = useRef(null);
    const historyHydrationRef = useRef(0);
    const activeScopeRef = useRef('');
    const activeVaultStorageScope = readChatStorage('gnosi_active_vault') || 'default';
    const workspaceStorageScope = readChatStorage('gnosi_workspace_id') || 'personal';
    const userStorageScope = (
        storageIdentity
        || readChatStorage('gnosi_user_id')
        || 'personal'
    );
    const browserStorageScope = agentChatStorageScope({
        vaultId: activeVaultStorageScope,
        workspaceId: workspaceStorageScope,
        userId: userStorageScope,
    });
    const scopedStorageKey = useCallback(
        (key) => scopedChatStorageKey(key, browserStorageScope),
        [browserStorageScope],
    );
    const scopeReady = (
        sessionsHydrated
        && hydratedStorageScope === browserStorageScope
    );

    useEffect(() => {
        if (embedded) {
            setIsOpen(true);
            setIsMinimized(false);
        }
    }, [embedded]);
    const clearDraftMentions = useCallback(() => setSelectedMentions([]), []);
    const clearDraftAttachments = useCallback(() => setAttachments([]), []);
    const sessionContext = {
        browserStorageScope, defaultSessionTitle, embedded, forcedAgentId, forcedSessionId,
        notebookId, isLoading, scopeReady, selectedAgentId, sessionId, chatSessions, messages,
        scopedStorageKey, requestAbortRef, historyHydrationRef, setChatSessions, setMessages,
        setSelectedAgentId, setSessionId, setSessionsHydrated, setHydratedStorageScope,
        setPendingConfirmation, setAgentRuntime, clearDraftMentions, clearDraftAttachments,
        setInputValue, setShowSessionsView,
    };
    useChatSessionPersistence(sessionContext);
    useNotebookConversation(sessionContext);
    const { selectSession, archiveCurrentSession, createNewSession, deleteSessionById } =
        useChatSessionSelection(sessionContext);

    useEffect(() => () => requestAbortRef.current?.abort(), []);

    useEffect(() => {
        if (!isLoading || processingStartedAtRef.current === null) {
            setProcessingElapsedSeconds(0);
            return undefined;
        }
        const updateElapsed = () => {
            setProcessingElapsedSeconds(Math.max(
                0,
                Math.round(
                    ((performance.now() - processingStartedAtRef.current) / 1000) * 10,
                ) / 10,
            ));
        };
        updateElapsed();
        const timer = window.setInterval(updateElapsed, 250);
        return () => window.clearInterval(timer);
    }, [isLoading]);

    useEffect(() => {
        const nextScope = `${browserStorageScope}:${selectedAgentId}:${sessionId}`;
        if (activeScopeRef.current && activeScopeRef.current !== nextScope) {
            requestAbortRef.current?.abort();
            setPendingConfirmation(null);
        }
        activeScopeRef.current = nextScope;
    }, [browserStorageScope, selectedAgentId, sessionId]);

    useSessionMessageBinding(sessionContext);

    const { mentionResults, showMentionMenu, setShowMentionMenu, applyMention, loadMentionCatalog } =
        useChatMentions({ inputValue, inputRef, setInputValue, setSelectedMentions });
    const { agentConfig, agentList, loadConfig } =
        useChatConfiguration({ forcedAgentId, selectedAgentId, setSelectedAgentId });

    useEffect(() => {
        void loadConfig();
        void loadMentionCatalog();
    }, [loadConfig, loadMentionCatalog]);


    const { handlePickAttachment, handleAttachmentInputChange, removeAttachment } =
        useChatAttachments({
            selectedAgentId, sessionId, attachments, isUploadingAttachment, fileInputRef,
            setAttachments, setIsUploadingAttachment, setMessages,
        });

    const handleChatKeyDown = (event) => {
        if (event.defaultPrevented) return;
        const isComposer = event.target === inputRef.current;
        const scrollDelta = chatScrollDeltaForComposerKey({
            key: event.key,
            value: isComposer ? event.target.value : '',
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
        });
        if (!scrollDelta) return;
        event.preventDefault();
        messagesContainerRef.current?.scrollBy({ top: scrollDelta, behavior: 'smooth' });
    };


    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen, isMinimized]);

    const {
        confirmationTitle, confirmationSummary, confirmPendingAction, cancelPendingAction,
    } = useAgentConfirmations({
        browserStorageScope, scopeReady, selectedAgentId, sessionId, activeScopeRef,
        setMessages, pendingConfirmation, setPendingConfirmation,
    });
    const confirmationReview = useCallback((confirmation) => (
        <ConfirmationReview confirmation={confirmation} summary={confirmationSummary(confirmation)} />
    ), [confirmationSummary]);

    const { focusComposerWith, copyMessage, quoteMessage, markMessage, submitMessageFeedback, refreshMessageJob, previousUserPrompt, retryMessage } = useChatMessageActions({
        messages, setMessages, agentName: agentConfig?.name, selectedAgentId, sessionId, isLoading,
        inputRef, setInputValue, setShowMentionMenu,
    });
    const confirmConversationRewind = useChatRewind({
        messages, selectedAgentId, sessionId, notebookId, pendingRewindIndex, isLoading, isRewinding,
        historyHydrationRef, setMessages, setPendingConfirmation, setDetailsMessageIndex,
        setPendingRewindIndex, setIsRewinding, focusComposerWith,
    });

    const handleSubmit = (event) => {
        event.preventDefault();
        return submitChatTurn({
            t, inputValue, attachments, readOnly, isLoading, agentHasModel, selectedMentions,
            processingStartedAtRef, setMessages, setInputValue, clearDraftMentions,
            clearDraftAttachments, setShowMentionMenu, setIsLoading, setProcessingPhase,
            browserStorageScope, selectedAgentId, sessionId, activeScopeRef, activeStreamRef,
            setAgentRuntime, confirmationSummary, requestAbortRef, contextRefs, notebookId, inputRef,
        });
    };

    const agentName = agentConfig?.name || 'Gnosi Copilot';
    const agentIcon = agentConfig?.icon || 'lucide:Brain:white';
    const agentHasModel = Boolean(agentConfig?.provider && agentConfig?.model);
    const agentModel = agentHasModel
        ? `${agentConfig.provider} · ${agentConfig.model}`
        : t('chat.model_not_configured', 'Model not configured');
    const runtimeStatus = deriveAgentRuntimeStatus(agentRuntime, agentHasModel);
    const runtimeLimited = runtimeStatus.limited;
    const runtimeStatusLabel = {
        model_missing: t('chat.model_not_configured', 'Model not configured'),
        model_no_tools: t('chat.runtime_model_no_tools', 'Connected · model without tools'),
        missing_skills: t('chat.runtime_missing_skills', 'Connected · skills missing'),
        unavailable_tools: t('chat.runtime_unavailable_tools', 'Connected · tools unavailable'),
        ready: t('chat.runtime_ready', 'Connected · {{count}} tools', { count: runtimeStatus.count }),
        online: t('chat.online', 'Online'),
    }[runtimeStatus.kind];
    const runtimeStatusHelp = {
        model_no_tools: t(
            'chat.runtime_model_no_tools_help',
            'This model cannot execute the assigned skills. Choose a tool-capable model in Settings → AI.',
        ),
        missing_skills: t(
            'chat.runtime_missing_skills_help',
            '{{count}} assigned skill is missing or disabled.',
            { count: runtimeStatus.count },
        ),
        unavailable_tools: t(
            'chat.runtime_unavailable_tools_help',
            '{{count}} assigned tool is unavailable in this runtime.',
            { count: runtimeStatus.count },
        ),
    }[runtimeStatus.kind] || '';
    const sortedSessions = chatSessions
        .filter((session) => session.agentId === selectedAgentId)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

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
                                    onClick={() => {
                                        const streamId = activeStreamRef.current;
                                        if (streamId) {
                                            void cancelChatStream({ streamId, agentId: selectedAgentId, sessionId })
                                                .catch(error => logChatError('agent-chat-stream-cancel', error));
                                        }
                                        requestAbortRef.current?.abort();
                                    }}
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
                message={pendingConfirmation ? confirmationReview(pendingConfirmation) : ''}
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
};

export default AgentChat;
