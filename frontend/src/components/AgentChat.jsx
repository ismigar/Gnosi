import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, X, Paperclip, Brain, Sparkles, Plus, AtSign, Archive, Copy, Reply, RotateCcw, Pencil, ThumbsUp, ThumbsDown, Info, Bookmark, Undo2, Blocks } from 'lucide-react';
import { useExclusiveFloatingPanel } from '../hooks/useExclusiveFloatingPanel';
import { useFloatingActionDock } from '../hooks/useFloatingActionDock';
import ConfirmModal from './ConfirmModal';
import {
    agentChatStorageScope,
} from './agentConfirmationUtils';
import { chatScrollDeltaForComposerKey } from './agentChatKeyboardUtils';
import {
    boundedProcessingMs,
    effectiveMessageTimingMs,
    getTurnId,
    processingSeconds,
} from './agentChatMessageUtils';
import { selectedMentionsInText } from './agentChatMentionUtils';
import { deriveAgentRuntimeStatus } from './agentRuntimeStatus';
import { readChatStorage, scopedChatStorageKey } from './agent-chat/chatPersistence';
import { useChatSessionPersistence } from './agent-chat/useChatSessionPersistence';
import { useNotebookConversation } from './agent-chat/useNotebookConversation';
import { useChatSessionSelection, useSessionMessageBinding } from './agent-chat/useChatSessionSelection';
import { readNdjsonRecords } from '../shared/api/ndjson';
import { ConfirmationReview } from './agent-chat/ConfirmationReview';
import { useAgentConfirmations } from './agent-chat/useAgentConfirmations';
import { logError } from '../lib/notifyError';
import { startChatStream, cancelChatStream } from '../shared/api/chat-streaming';
import { useChatMentions } from './agent-chat/useChatMentions';
import { useChatConfiguration } from './agent-chat/useChatConfiguration';
import { useChatAttachments } from './agent-chat/useChatAttachments';
import { CHAT_ATTACHMENT_ACCEPT } from './agent-chat/composerModel';
import { MessageDetails } from './agent-chat/MessageDetails';
import { ChatHeader } from './agent-chat/ChatHeader';
import { ChatDock } from './agent-chat/ChatDock';
import { ChatSessionList } from './agent-chat/ChatSessionList';
import { useChatMessageActions } from './agent-chat/useChatMessageActions';
import { useChatRewind } from './agent-chat/useChatRewind';
import { createChatStreamState } from './agent-chat/streamEventModel';
import { applyChatStreamEvent } from './agent-chat/applyChatStreamEvent';
import { recoverChatStream } from './agent-chat/recoverChatStream';
import { logChatError } from './agent-chat/chatDiagnostics';

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

    const autoResizeInput = () => {
        if (!inputRef.current) return;
        inputRef.current.style.height = '0px';
        inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    };

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

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (readOnly || (!inputValue.trim() && attachments.length === 0) || isLoading || !agentHasModel) return;

        const turnId = crypto.randomUUID();
        const processingStartedAt = performance.now();
        processingStartedAtRef.current = processingStartedAt;
        const mentions = selectedMentionsInText(inputValue, selectedMentions);
        const attachmentsPayload = attachments.map((item) => ({
            name: item.name,
            size: item.size,
            type: item.type,
            path: item.path,
            url: item.url,
        }));

        const visibleContent = inputValue.trim() ? inputValue : t('chat.attachments_only_label', "(Attachments)");

        const userMsg = {
            role: 'user',
            content: visibleContent,
            turnId,
            mentions,
            attachments: attachmentsPayload,
        };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setSelectedMentions([]);
        setAttachments([]);
        setShowMentionMenu(false);
        setIsLoading(true);
        setProcessingPhase('routing');
        const requestScope = `${browserStorageScope}:${selectedAgentId}:${sessionId}`;
        const streamState = createChatStreamState();
        const streamContext = {
            t, requestScope, agentId: selectedAgentId, sessionId, turnId,
            activeScopeRef, activeStreamRef, setMessages, setAgentRuntime, setProcessingPhase,
            confirmationSummary,
        };

        try {
            requestAbortRef.current?.abort();
            const controller = new AbortController();
            requestAbortRef.current = controller;
            const response = await startChatStream({
                message: inputValue,
                agent_id: selectedAgentId,
                session_id: sessionId,
                llm_mode: 'agent_default',
                mentions,
                attachments: attachmentsPayload,
                context_refs: contextRefs,
                notebook_id: notebookId || undefined,
                turn_id: turnId,
            }, controller.signal);

            if (!response.ok) {
                let detail = response.statusText;
                try {
                    const error = await response.json();
                    if (error?.detail?.code === 'agent_model_unavailable') {
                        detail = t('chat.agent_model_unavailable', 'The selected agent model is unavailable. Configure the agent and try again.');
                    } else if (typeof error?.detail === 'string') {
                        detail = error?.detail || detail;
                    }
                } catch {
                    // The HTTP status remains a useful fallback for non-JSON errors.
                }
                throw new Error(detail);
            }

            for await (const data of readNdjsonRecords(response, {
                onMalformed: (error) => logError('chat.stream.record', error),
            })) {
                    try {
                        applyChatStreamEvent(streamState, data, streamContext);
                    } catch (error) {
                        logError('chat.stream.event', error);
                    }
            }
            if (!streamState.terminal || !streamState.responseReceived) {
                setMessages((prev) => {
                    if (activeScopeRef.current !== requestScope) return prev;
                    return [...prev, {
                        role: 'system',
                        content: `${t('chat.error_prefix', 'Error')}: ${t('chat.empty_response', 'The assistant finished without returning a response. Please try again.')}`,
                        turnId,
                    }];
                });
            }
        } catch (error) {
            let recovered = false;
            if (
                error.name !== 'AbortError'
                && streamState.streamId
                && activeScopeRef.current === requestScope
            ) {
                try {
                    recovered = await recoverChatStream(streamState, streamContext);
                } catch (resumeError) {
                    logChatError('agent-chat-stream-resume', resumeError);
                }
            }
            if (error.name !== 'AbortError' && !recovered && activeScopeRef.current === requestScope) {
                const errorMessage = typeof error.message === 'string'
                    ? error.message.trim()
                    : '';
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `${t('chat.error_prefix', 'Error')}: ${errorMessage || t('errors.unknown', 'Unknown error')}`,
                    turnId,
                    errorCode: 'network_error',
                    retryable: true,
                    recovery: {
                        retryable: true,
                        action: 'retry_message',
                        automatic: false,
                        max_attempts: 1,
                    },
                }]);
            }
        } finally {
            const elapsedMs = boundedProcessingMs(
                performance.now() - processingStartedAt,
            );
            setMessages((previous) => {
                if (activeScopeRef.current !== requestScope) return previous;
                const responseIndex = previous.findLastIndex((message) => (
                    message?.turnId === turnId && message?.role !== 'user'
                ));
                if (responseIndex < 0) return previous;
                return previous.map((message, index) => (
                    index === responseIndex
                        ? {
                            ...message,
                            processingMs: elapsedMs,
                            ...(streamState.metrics ? { timings: streamState.metrics } : {}),
                            ...Object.fromEntries(
                                Object.entries(streamState.transparency)
                                    .filter(([field, value]) => value !== null && message[field] == null),
                            ),
                        }
                        : message
                ));
            });
            requestAbortRef.current = null;
            activeStreamRef.current = '';
            processingStartedAtRef.current = null;
            setIsLoading(false);
            setProcessingPhase('routing');
            if (inputRef.current) {
                inputRef.current.style.height = 'auto';
            }
        }
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
                            <div key={idx} style={{
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
                                    {msg.role === 'assistant' && msg.citations?.claims?.length > 0 && (
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
                                                        .map(citationId => msg.citations.sources.find(source => source.citation_id === citationId))
                                                        .filter(Boolean);
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
                                                    onClick={() => setPendingConfirmation(msg.confirmation)}
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
                                    {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {msg.attachments.map((item, idx2) => (
                                                <div key={`${item.name || 'file'}-${idx2}`} style={{ fontSize: '0.76rem', opacity: 0.95 }}>
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
                                    <button type="button" onClick={() => copyMessage(msg.content)} aria-label={t('chat.copy_message', 'Copy message')} title={t('chat.copy_message', 'Copy message')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Copy size={13} /></button>
                                    {!readOnly && <button type="button" onClick={() => quoteMessage(msg)} aria-label={t('chat.reply_to_message', 'Reply to message')} title={t('chat.reply_to_message', 'Reply to message')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Reply size={13} /></button>}
                                    {!readOnly && msg.role === 'user' && (
                                        <button type="button" onClick={() => focusComposerWith(msg.content || '')} aria-label={t('chat.edit_message', 'Edit and resend')} title={t('chat.edit_message', 'Edit and resend')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Pencil size={13} /></button>
                                    )}
                                    {!readOnly && msg.role === 'assistant' && previousUserPrompt(idx) && (
                                        <button type="button" onClick={() => focusComposerWith(previousUserPrompt(idx))} aria-label={t('chat.regenerate_message', 'Regenerate response')} title={t('chat.regenerate_message', 'Regenerate response')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><RotateCcw size={13} /></button>
                                    )}
                                    {!readOnly && msg.role === 'assistant' && msg.retryable && previousUserPrompt(idx) && (
                                        <button type="button" onClick={() => retryMessage(idx)} aria-label={t('chat.retry_response', 'Retry response')} title={t('chat.retry_response', 'Retry response')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: isLoading ? 'default' : 'pointer', padding: '3px', opacity: isLoading ? 0.45 : 1 }} disabled={isLoading}><RotateCcw size={13} /></button>
                                    )}
                                    {msg.role === 'assistant' && (
                                        <>
                                            <button type="button" onClick={() => submitMessageFeedback(idx, 'up')} aria-label={t('chat.helpful_response', 'Helpful response')} title={t('chat.helpful_response', 'Helpful response')} aria-pressed={msg.feedback === 'up'} style={{ background: 'none', border: 'none', color: msg.feedback === 'up' ? 'var(--gnosi-blue, #2563eb)' : 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><ThumbsUp size={13} /></button>
                                            <button type="button" onClick={() => submitMessageFeedback(idx, 'down')} aria-label={t('chat.unhelpful_response', 'Unhelpful response')} title={t('chat.unhelpful_response', 'Unhelpful response')} aria-pressed={msg.feedback === 'down'} style={{ background: 'none', border: 'none', color: msg.feedback === 'down' ? 'var(--status-error, #dc2626)' : 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><ThumbsDown size={13} /></button>
                                            <button type="button" onClick={() => markMessage(idx, 'saved', !msg.saved)} aria-label={t('chat.save_message', 'Save message')} title={t('chat.save_message', 'Save message')} aria-pressed={Boolean(msg.saved)} style={{ background: 'none', border: 'none', color: msg.saved ? 'var(--gnosi-blue, #2563eb)' : 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Bookmark size={13} fill={msg.saved ? 'currentColor' : 'none'} /></button>
                                        </>
                                    )}
                                    {!readOnly && conversationMode !== 'shared' && (msg.role === 'assistant' || msg.role === 'user') && (
                                        msg.undo?.available
                                        || Boolean(getTurnId(msg))
                                    ) && (() => {
                                        const hasDirectUndo = typeof msg?.undo?.run === 'function';
                                        const undoHint = hasDirectUndo
                                            ? t('chat.undo_last_action', 'Undo last action')
                                            : t('chat.rewind_from_message', 'Undo from this message');
                                        return (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (hasDirectUndo) return msg.undo.run();
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
                                    <button type="button" onClick={() => setDetailsMessageIndex(detailsMessageIndex === idx ? null : idx)} aria-label={t('chat.message_details', 'Message details')} title={t('chat.message_details', 'Message details')} aria-expanded={detailsMessageIndex === idx} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Info size={13} /></button>
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
                    {readOnly ? (
                        <div role="status" style={{ padding: '12px 16px', borderTop: '1px solid var(--settings-border, #e5e7eb)', background: 'var(--settings-sidebar-bg, #f3f4f6)', color: 'var(--text-secondary)', fontSize: '0.78rem', textAlign: 'center' }}>
                            {t('notebooks.chat_read_only', 'You can read this conversation. An editor role is required to send messages.')}
                        </div>
                    ) : <div style={{ padding: '10px 10px 8px 10px', borderTop: '1px solid var(--settings-border, #e5e7eb)', background: 'var(--bg-primary)' }}>
                        <div style={{ position: 'relative' }}>
                            <form onSubmit={handleSubmit} style={{
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
                                    onChange={handleAttachmentInputChange}
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
                                            handleSubmit(e);
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
                                            <button type="button" onClick={() => removeAttachment(item.id)} aria-label={t('chat.remove_attachment_aria', "Remove attachment {{name}}", { name: item.name || '' }).trim()} title={t('chat.remove_attachment_title', "Remove attachment")} style={{ border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, lineHeight: 1 }}>x</button>
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
                                <button onClick={createNewSession} disabled={isLoading} title={t('chat.new_session', "New session")} aria-label={t('chat.new_session', "New session")} style={{ width: '26px', height: '26px', borderRadius: '13px', border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', cursor: isLoading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Plus size={12} />
                                </button>
                                <button onClick={() => setShowSessionsView((v) => !v)} title={t('chat.sessions', 'Sessions')} aria-label={t('chat.sessions', 'Sessions')} style={{ width: '26px', height: '26px', borderRadius: '13px', border: '1px solid var(--settings-border, #e5e7eb)', background: showSessionsView ? 'var(--settings-sidebar-bg, #f3f4f6)' : 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Archive size={12} />
                                </button>
                            </div>
                        </div>}
                    </div>}
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
