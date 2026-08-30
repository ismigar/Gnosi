import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, X, Paperclip, Brain, Sparkles, Plus, AtSign, Archive, Copy, Reply, RotateCcw, Pencil, ThumbsUp, ThumbsDown, Info, Bookmark, Undo2, Blocks } from 'lucide-react';
import { useExclusiveFloatingPanel } from '../hooks/useExclusiveFloatingPanel';
import { useFloatingActionDock } from '../hooks/useFloatingActionDock';
import ConfirmModal from './ConfirmModal';
import {
    agentChatStorageScope,
    mergeConfirmationRecords,
} from './agentConfirmationUtils';
import { chatScrollDeltaForComposerKey } from './agentChatKeyboardUtils';
import {
    boundedProcessingMs,
    boundedJob,
    boundedTransparencyMetadata,
    boundedTurnMetrics,
    effectiveMessageTimingMs,
    conversationRewindPlan,
    getTurnId,
    mergeCanonicalMessageMetadata,
    isRetryableErrorCode,
    processingSeconds,
} from './agentChatMessageUtils';
import { selectedMentionsInText } from './agentChatMentionUtils';
import { deriveAgentRuntimeStatus } from './agentRuntimeStatus';
import { toast } from '../lib/toast';
import { readChatStorage, scopedChatStorageKey } from './agent-chat/chatPersistence';
import { useChatSessionPersistence } from './agent-chat/useChatSessionPersistence';
import { useNotebookConversation } from './agent-chat/useNotebookConversation';
import { useChatSessionSelection, useSessionMessageBinding } from './agent-chat/useChatSessionSelection';
import { readNdjsonRecords } from '../shared/api/ndjson';
import { ConfirmationReview } from './agent-chat/ConfirmationReview';
import { useAgentConfirmations } from './agent-chat/useAgentConfirmations';
import { acceptStreamSequence } from './agent-chat/streamSequence';
import { logError } from '../lib/notifyError';
import { streamFetch } from '../shared/api/specialized-transports';
import { transportFetch } from '../shared/api/transports';
import { useChatMentions } from './agent-chat/useChatMentions';
import { useChatConfiguration } from './agent-chat/useChatConfiguration';
import { useChatAttachments } from './agent-chat/useChatAttachments';
import { CHAT_ATTACHMENT_ACCEPT } from './agent-chat/composerModel';
import { MessageDetails } from './agent-chat/MessageDetails';
import { ChatHeader } from './agent-chat/ChatHeader';
import { ChatDock } from './agent-chat/ChatDock';
import { ChatSessionList } from './agent-chat/ChatSessionList';

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
    const { t, i18n } = useTranslation();
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

    const focusComposerWith = useCallback((value) => {
        setInputValue(value);
        setShowMentionMenu(false);
        requestAnimationFrame(() => inputRef.current?.focus());
    }, []);

    const copyMessage = useCallback(async (content) => {
        try {
            await navigator.clipboard.writeText(String(content || ''));
            toast.success(t('chat.message_copied', 'Message copied'));
        } catch (error) {
            console.error('Could not copy assistant message', error);
            toast.error(t('chat.copy_failed', 'Could not copy the message'));
        }
    }, [t]);

    const quoteMessage = useCallback((message) => {
        const prefix = message?.role === 'user'
            ? t('chat.you', 'You')
            : agentConfig?.name || 'Gnosi Copilot';
        focusComposerWith(`> ${prefix}: ${String(message?.content || '').replace(/\n/g, '\n> ')}\n\n`);
    }, [agentConfig?.name, focusComposerWith, t]);

    const markMessage = useCallback((index, field, value) => {
        setMessages((previous) => previous.map((message, messageIndex) => (
            messageIndex === index ? { ...message, [field]: value } : message
        )));
    }, []);

    const submitMessageFeedback = useCallback(async (index, rating) => {
        const message = messages[index];
        if (!message?.turnId || message.role !== 'assistant') return;
        const previousRating = message.feedback || null;
        const nextRating = rating === previousRating ? null : rating;
        markMessage(index, 'feedback', nextRating);
        try {
            const response = await transportFetch('/api/chat/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agent_id: selectedAgentId,
                    session_id: sessionId,
                    turn_id: message.turnId,
                    rating: nextRating || 'clear',
                    language: String(i18n.resolvedLanguage || i18n.language || 'en').slice(0, 8),
                    mode: message.plan?.mode || message.explanation?.mode || 'analysis',
                    domains: message.plan?.domains || [],
                    route: message.plan?.route || message.explanation?.route || 'General',
                    execution: message.plan?.execution || message.explanation?.execution || 'foreground',
                    output_strategy: message.plan?.output_strategy || message.explanation?.output_strategy || 'model_synthesis',
                    required_tool: message.plan?.required_tool || '',
                    verification_status: message.verification?.status || '',
                    limitations: message.verification?.limitations || [],
                    tool_names: message.verification?.tool_names || [],
                    duration_ms: effectiveMessageTimingMs(message) || 0,
                    error_code: message.errorCode || '',
                }),
            });
            if (!response.ok) throw new Error(`Assistant feedback failed (${response.status})`);
        } catch (error) {
            console.error('Could not record assistant feedback', error);
            markMessage(index, 'feedback', previousRating);
            toast.error(t('chat.feedback_failed', 'Could not record response feedback.'));
        }
    }, [i18n.language, i18n.resolvedLanguage, markMessage, messages, selectedAgentId, sessionId, t]);

    const refreshMessageJob = useCallback(async (index, action = 'status') => {
        const job = messages[index]?.job;
        if (!job?.job_id) return;
        try {
            const suffix = action === 'status' ? '' : `/${action}`;
            const response = await transportFetch(
                `/api/ai/jobs/${encodeURIComponent(job.job_id)}${suffix}`,
                { method: action === 'status' ? 'GET' : 'POST' },
            );
            if (!response.ok) throw new Error(`Capability job request failed (${response.status})`);
            const payload = await response.json();
            const nextJob = boundedJob({
                ...job,
                ...payload,
                capabilities: payload.capabilities || job.capabilities,
            });
            if (nextJob) markMessage(index, 'job', nextJob);
        } catch (error) {
            console.error('Could not update capability job', error);
            toast.error(t('chat.job_update_failed', 'Could not update the background job.'));
        }
    }, [markMessage, messages, t]);

    const previousUserPrompt = useCallback((index) => {
        for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
            if (messages[cursor]?.role === 'user' && messages[cursor]?.content) {
                return messages[cursor].content;
            }
        }
        return '';
    }, [messages]);

    const retryMessage = useCallback((index) => {
        if (isLoading) return;
        const prompt = previousUserPrompt(index);
        if (!prompt) return;
        focusComposerWith(prompt);
        toast.info(t(
            'chat.retry_prefilled',
            'The original request is ready to retry. Review it and send again.',
        ));
    }, [focusComposerWith, isLoading, previousUserPrompt, t]);

    const confirmConversationRewind = useCallback(async () => {
        if (pendingRewindIndex === null || isLoading || isRewinding) return;
        const plan = conversationRewindPlan(messages, pendingRewindIndex);
        if (!plan) return;

        setIsRewinding(true);
        try {
            const response = await transportFetch(
                `/api/chat/sessions/${encodeURIComponent(selectedAgentId)}/${encodeURIComponent(sessionId)}/rewind${notebookId ? `?notebook_id=${encodeURIComponent(notebookId)}` : ''}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        before_turn_id: plan.beforeTurnId,
                        keep_messages: plan.keepMessages,
                    }),
                },
            );
            if (!response.ok) {
                throw new Error(`Conversation rewind failed (${response.status})`);
            }
            const canonical = await response.json();
            const localPrefix = messages.slice(0, plan.localKeepCount);
            const rewoundMessages = mergeCanonicalMessageMetadata(
                canonical.messages,
                localPrefix,
            );
            historyHydrationRef.current += 1;
            setMessages(rewoundMessages);
            setPendingConfirmation(null);
            setDetailsMessageIndex(null);
            setPendingRewindIndex(null);
            if (plan.prompt) focusComposerWith(plan.prompt);
            toast.success(t(
                'chat.rewind_complete',
                'Conversation rewound. Completed external actions were not reversed.',
            ));
        } catch (error) {
            console.error('Could not rewind assistant conversation', error);
            toast.error(t(
                'chat.rewind_failed',
                'The conversation could not be rewound.',
            ));
        } finally {
            setIsRewinding(false);
        }
    }, [
        focusComposerWith,
        isLoading,
        isRewinding,
        messages,
        notebookId,
        pendingRewindIndex,
        selectedAgentId,
        sessionId,
        t,
    ]);

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
        let turnMetrics = null;
        let turnTransparency = boundedTransparencyMetadata({});
        let resumeStreamId = '';
        let lastStreamSequence = 0;
        let selectedLlm = null;

        try {
            requestAbortRef.current?.abort();
            const controller = new AbortController();
            requestAbortRef.current = controller;
            const response = await streamFetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: inputValue,
                    agent_id: selectedAgentId,
                    session_id: sessionId,
                    llm_mode: 'agent_default',
                    mentions,
                    attachments: attachmentsPayload,
                    context_refs: contextRefs,
                    notebook_id: notebookId || undefined,
                    turn_id: turnId,
                }),
                signal: controller.signal,
            });

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

            let aiMsgAdded = false;
            let terminalReceived = false;
            let responseReceived = false;
            for await (const data of readNdjsonRecords(response, {
                onMalformed: (error) => logError('chat.stream.record', error),
            })) {
                    try {
                        // The server envelope makes reconnects and proxy retries
                        // safe at the presentation layer. Never apply a duplicate
                        // event, while remaining compatible with legacy payloads.
                        const sequence = acceptStreamSequence(data.sequence, lastStreamSequence);
                        if (!sequence.accepted) continue;
                        lastStreamSequence = sequence.sequence;

                        if (data.type === 'stream_open') {
                            resumeStreamId = String(data.stream_id || '');
                            activeStreamRef.current = resumeStreamId;
                            continue;
                        }
                        if (data.type === 'heartbeat') {
                            continue;
                        }

                        if (data.type === 'llm_selected') {
                            selectedLlm = {
                                mode: data.mode || 'agent_default',
                                provider: data.provider,
                                model: data.model,
                                strategy: data.strategy,
                            };
                            continue;
                        }
                        if (data.type === 'agent_runtime') {
                            setAgentRuntime(data);
                            continue;
                        }
                        if (data.type === 'phase') {
                            setProcessingPhase(String(data.phase || 'routing'));
                            continue;
                        }
                        if (data.type === 'progress') {
                            setProcessingPhase(String(data.phase || 'routing'));
                            continue;
                        }
                        if (data.type === 'deadline') {
                            setProcessingPhase('synthesis');
                            continue;
                        }
                        if (data.type === 'turn_plan') {
                            turnTransparency = boundedTransparencyMetadata({
                                plan: data.plan,
                                privacy: data.privacy,
                                job: data.job?.job_id ? data.job : null,
                            });
                            continue;
                        }
                        if (data.type === 'turn_metrics') {
                            turnMetrics = boundedTurnMetrics(data);
                            continue;
                        }
                        if (data.type === 'done') {
                            terminalReceived = true;
                            responseReceived = responseReceived || Boolean(data.has_response);
                            continue;
                        }
                        const carriesResponse = [
                            'tool_start', 'tool_end', 'message', 'thought', 'error',
                            'confirmation_required',
                        ].includes(data.type);
                        if (!carriesResponse) continue;

                        if ([
                            'message',
                            'thought',
                            'error',
                            'confirmation_required',
                        ].includes(data.type)) {
                            responseReceived = true;
                        }
                        if (
                            data.type === 'confirmation_required'
                            && activeScopeRef.current === requestScope
                        ) {
                            data.status = 'pending';
                            data.client_scope = requestScope;
                            data.agent_id = selectedAgentId;
                            data.session_id = sessionId;
                        }
                        const addAssistant = !aiMsgAdded;
                        aiMsgAdded = true;
                        setMessages(prev => {
                            if (activeScopeRef.current !== requestScope) return prev;
                            if (data.type === 'confirmation_required') {
                                return mergeConfirmationRecords(
                                    prev,
                                    [data],
                                    confirmationSummary,
                                ).map((message) => (
                                    message?.confirmation?.confirmation_id === data.confirmation_id
                                        ? { ...message, turnId }
                                        : message
                                ));
                            }
                            const newMsgs = [...prev];

                            // Metadata never creates an empty assistant bubble.
                            if (addAssistant) {
                                newMsgs.push({
                                    role: 'assistant',
                                    content: '',
                                    llm: selectedLlm,
                                    turnId,
                                    ...Object.fromEntries(
                                        Object.entries(turnTransparency)
                                            .filter(([, value]) => value !== null),
                                    ),
                                });
                            }

                            const lastIdx = newMsgs.length - 1;
                            const lastMsg = { ...newMsgs[lastIdx] };

                            if (data.type === 'tool_start') {
                                lastMsg.content = t('chat.tool_start', "🛠️ *Calling tool: {{tool}}...*", { tool: data.tool });
                            } else if (data.type === 'tool_end') {
                                lastMsg.content = data.awaiting_confirmation
                                    ? t('chat.tool_pending_confirmation', "🟡 *Tool {{tool}} is awaiting confirmation.*", { tool: data.tool })
                                    : t('chat.tool_end', "✅ *Tool {{tool}} finished.*", { tool: data.tool });
                            } else if (data.type === 'message' || data.type === 'thought') {
                                if (data.content) lastMsg.content = data.content;
                                const responseTransparency = boundedTransparencyMetadata({
                                    plan: data.plan || lastMsg.plan || turnTransparency.plan,
                                    privacy: data.privacy || lastMsg.privacy || turnTransparency.privacy,
                                    verification: data.verification,
                                    citations: data.citations,
                                    freshness: data.freshness,
                                    job: data.job,
                                    explanation: data.explanation,
                                    quality: data.quality,
                                    conflicts: data.conflicts,
                                    evidence_security: data.evidence_security,
                                });
                                Object.entries(responseTransparency).forEach(([field, value]) => {
                                    if (value !== null) lastMsg[field] = value;
                                });
                            } else if (data.type === 'error') {
                                // Translation and improvement of common messages
                                const streamedError = typeof data.content === 'string'
                                    ? data.content.trim()
                                    : '';
                                let errorContent = streamedError
                                    || t('errors.unknown', 'Unknown error');
                                if (data.code === 'agent_model_unavailable') {
                                    errorContent = t('chat.agent_model_unavailable', 'The selected agent model is unavailable. Configure the agent and try again.');
                                } else if (data.code === 'agent_turn_timeout') {
                                    errorContent = t('chat.turn_timeout', 'The response exceeded the 120-second processing limit. Please try again.');
                                } else if (data.code === 'agent_loop_exhausted') {
                                    errorContent = t('chat.agent_loop_exhausted', 'The agent repeated the same operation and stopped safely. Refine the request or try again.');
                                }
                                if (errorContent.includes('rate_limit_exceeded')) {
                                    errorContent = t('chat.rate_limit_message', "You've exceeded this agent model's quota. Try a different agent or wait a few minutes.");
                                }
                                lastMsg.content = `❌ ${t('chat.error_prefix', 'Error')}: ${errorContent}`;
                                lastMsg.errorCode = data.code || 'agent_error';
                                lastMsg.retryable = Boolean(data.retryable)
                                    || isRetryableErrorCode(lastMsg.errorCode);
                                if (data.recovery && typeof data.recovery === 'object') {
                                    lastMsg.recovery = data.recovery;
                                }
                            }
                            newMsgs[lastIdx] = lastMsg;
                            return newMsgs;
                        });
                    } catch (error) {
                        logError('chat.stream.event', error);
                    }
            }
            if (!terminalReceived || !responseReceived) {
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
                && resumeStreamId
                && activeScopeRef.current === requestScope
            ) {
                try {
                    let recoveredMessageSeen = false;
                    for (let attempt = 0; attempt < 120 && !recovered; attempt += 1) {
                        const resumeUrl = new URL(
                            `/api/chat/streams/${encodeURIComponent(resumeStreamId)}`,
                            window.location.origin,
                        );
                        resumeUrl.searchParams.set('agent_id', selectedAgentId);
                        resumeUrl.searchParams.set('session_id', sessionId);
                        resumeUrl.searchParams.set('after_sequence', String(lastStreamSequence));
                        const resumed = await transportFetch(resumeUrl.pathname + resumeUrl.search);
                        if (!resumed.ok) break;
                        const events = (await resumed.text())
                            .split('\n')
                            .filter(Boolean)
                            .map(line => JSON.parse(line));
                        let terminal = false;
                        let recoveredMessage = null;
                        for (const data of events) {
                            const sequence = acceptStreamSequence(data.sequence, lastStreamSequence);
                        if (!sequence.accepted) continue;
                        lastStreamSequence = sequence.sequence;
                            if (data.type === 'turn_metrics') turnMetrics = boundedTurnMetrics(data);
                            if (data.type === 'message' || data.type === 'thought' || data.type === 'error') {
                                recoveredMessage = data;
                            }
                            if (data.type === 'done') terminal = true;
                        }
                        if (recoveredMessage) {
                            recoveredMessageSeen = true;
                            setMessages(previous => {
                                if (activeScopeRef.current !== requestScope) return previous;
                                const index = previous.findLastIndex(message => (
                                    message?.turnId === turnId && message?.role !== 'user'
                                ));
                                const content = recoveredMessage.type === 'error'
                                    ? `${t('chat.error_prefix', 'Error')}: ${recoveredMessage.content || t('errors.unknown', 'Unknown error')}`
                                    : recoveredMessage.content;
                                const transparency = boundedTransparencyMetadata({
                                    plan: recoveredMessage.plan,
                                    privacy: recoveredMessage.privacy,
                                    verification: recoveredMessage.verification,
                                    citations: recoveredMessage.citations,
                                    freshness: recoveredMessage.freshness,
                                    job: recoveredMessage.job,
                                    explanation: recoveredMessage.explanation,
                                    quality: recoveredMessage.quality,
                                    conflicts: recoveredMessage.conflicts,
                                    evidence_security: recoveredMessage.evidence_security,
                                });
                                const recoveredFields = Object.fromEntries(
                                    Object.entries(transparency).filter(([, value]) => value !== null),
                                );
                                if (index < 0) return [...previous, {
                                    role: 'assistant', content, turnId, llm: selectedLlm, ...recoveredFields,
                                }];
                                return previous.map((message, itemIndex) => itemIndex === index
                                    ? { ...message, content, turnId, ...recoveredFields }
                                    : message);
                            });
                        }
                        recovered = terminal && recoveredMessageSeen;
                        if (!recovered) await new Promise(resolve => window.setTimeout(resolve, 1000));
                    }
                } catch (resumeError) {
                    console.error('Could not resume agent stream', resumeError);
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
                            ...(turnMetrics ? { timings: turnMetrics } : {}),
                            ...Object.fromEntries(
                                Object.entries(turnTransparency)
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
                                            const params = new URLSearchParams({
                                                agent_id: selectedAgentId,
                                                session_id: sessionId,
                                            });
                                            void transportFetch(
                                                `/api/chat/streams/${encodeURIComponent(streamId)}/cancel?${params}`,
                                                { method: 'POST' },
                                            ).catch(error => console.error('Could not cancel agent stream:', error));
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
