import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { moveQueuedPrompt, mutatePromptQueue, queuedDraftStillCurrent, queueStorageKey, restorePromptQueue, type QueuedPrompt } from './promptQueue';
import { isLearningRequest } from '../../agent-learning';
import { useState, useRef, useEffect, useEffectEvent, useCallback, type KeyboardEvent, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useExclusiveFloatingPanel } from '../../../shared/hooks/useExclusiveFloatingPanel';
import { useFloatingActionDock } from '../../../shared/hooks/useFloatingActionDock';
import { agentChatStorageScope } from '../model/agentConfirmationUtils';
import { chatScrollDeltaForComposerKey } from '../model/agentChatKeyboardUtils';
import { deriveAgentRuntimeStatus, type AgentRuntimeState, type AgentRuntimeStatusKind } from '../model/agentRuntimeStatus';
import type { AgentChatMention } from '../model/agentChatMentionUtils';
import type { AgentConfirmation } from './confirmationModel';
import type { ChatAttachment } from './composerModel';
import type { StoredChatMessage, StoredChatSession } from './sessionModel';
import type { AgentChatProps } from './agentChatTypes';
import { readChatStorage, scopedChatStorageKey } from './chatPersistence';
import { useChatSessionPersistence } from './useChatSessionPersistence';
import { useNotebookConversation } from './useNotebookConversation';
import { useChatSessionSelection, useSessionMessageBinding } from './useChatSessionSelection';
import { useAgentConfirmations } from './useAgentConfirmations';
import { cancelChatStream } from '../../../shared/api/chat-streaming';
import { useChatMentions } from './useChatMentions';
import { useChatConfiguration } from './useChatConfiguration';
import { useChatAttachments } from './useChatAttachments';
import { useChatMessageActions } from './useChatMessageActions';
import { useChatRewind } from './useChatRewind';
import { logChatError } from './chatDiagnostics';
import { submitChatTurn } from './submitChatTurn';
import { useChatPanelState } from './useChatPanelState';

export function useAgentChatController({
  storageIdentity = '', contextRefs = [], embedded = false, forcedSessionId = '',
  forcedAgentId = '', notebookId = '', conversationMode = 'private_member', readOnly = false,
  initiallyOpen = false,
}: AgentChatProps) {
    const { t } = useTranslation();
    const defaultSessionTitle = t('chat.default_session_title', 'New conversation');
    const { isOpen, setIsOpen, isMinimized, setIsMinimized } = useChatPanelState(embedded, initiallyOpen);
    const [messages, setMessages] = useState<readonly StoredChatMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [showLearning, setShowLearning] = useState(false);
    const [learningGoal, setLearningGoal] = useState('');
    const [learningScope, setLearningScope] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState('');
    const [selectedAgentId, setSelectedAgentId] = useState('');
    const [chatSessions, setChatSessions] = useState<StoredChatSession[]>([]);
    const [sessionsHydrated, setSessionsHydrated] = useState(false);
    const [hydratedStorageScope, setHydratedStorageScope] = useState('');
    const [showSessionsView, setShowSessionsView] = useState(false);
    const [selectedMentions, setSelectedMentions] = useState<AgentChatMention[]>([]);
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
    const [pendingConfirmation, setPendingConfirmation] = useState<AgentConfirmation | null>(null);
    const [agentRuntime, setAgentRuntime] = useState<AgentRuntimeState | null>(null);
    const [detailsMessageIndex, setDetailsMessageIndex] = useState<number | null>(null);
    const [processingElapsedSeconds, setProcessingElapsedSeconds] = useState(0);
    const [processingPhase, setProcessingPhase] = useState('routing');
    const [pendingRewindIndex, setPendingRewindIndex] = useState<number | null>(null);
    const [isRewinding, setIsRewinding] = useState(false);
    const [isDockOpen, setIsDockOpen] = useFloatingActionDock();
    useExclusiveFloatingPanel('chat', !embedded && isOpen, setIsOpen);

    // Ref to scroll to the bottom
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const requestAbortRef = useRef<AbortController | null>(null);
    const activeStreamRef = useRef('');
    const processingStartedAtRef = useRef<number | null>(null);
    const historyHydrationRef = useRef(0);
    const activeScopeRef = useRef('');
    const loadedChatResourcesScopeRef = useRef('');
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
        (key: string) => scopedChatStorageKey(key, browserStorageScope),
        [browserStorageScope],
    );
    const scopeReady = (
        sessionsHydrated
        && hydratedStorageScope === browserStorageScope
    );

    const clearDraftMentions = useCallback(() => { setSelectedMentions([]); }, []);
    const clearDraftAttachments = useCallback(() => { setAttachments([]); }, []);
    const selectedProfileId = chatSessions.find(session => session.id === sessionId)?.profileId || selectedAgentId;
    const { agentConfig, agentList, defaultAgentId, loadConfig } =
        useChatConfiguration({ selectedAgentId: selectedProfileId, setSelectedAgentId });
    const selectProfile = (profileId: string) => {
        if (isLoading || isRewinding || readOnly || isUploadingAttachment || !agentList.some(profile => profile.id === profileId)) return;
        setChatSessions(previous => previous.map(session => session.id === sessionId ? { ...session, profileId } : session));
        setAgentRuntime(null);
    };
    const sessionContext = {
        browserStorageScope, defaultSessionTitle, defaultAgentId, embedded, forcedAgentId, forcedSessionId,
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
            const startedAt = processingStartedAtRef.current;
            if (startedAt === null) return;
            setProcessingElapsedSeconds(Math.max(
                0,
                Math.round(
                    ((performance.now() - startedAt) / 1000) * 10,
                ) / 10,
            ));
        };
        updateElapsed();
        const timer = window.setInterval(updateElapsed, 250);
        return () => { window.clearInterval(timer); };
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

    const loadChatResources = useEffectEvent(() => {
        void loadConfig();
        void loadMentionCatalog();
    });
    useEffect(() => {
        if (!embedded && !isOpen) {
            loadedChatResourcesScopeRef.current = '';
            return;
        }
        const scope = `${browserStorageScope}:${forcedAgentId || 'default'}`;
        if (loadedChatResourcesScopeRef.current === scope) return;
        loadedChatResourcesScopeRef.current = scope;
        loadChatResources();
    }, [browserStorageScope, embedded, forcedAgentId, isOpen]);


    const { handlePickAttachment, handleAttachmentInputChange, removeAttachment } =
        useChatAttachments({
            selectedAgentId, sessionId, attachments, isUploadingAttachment, fileInputRef,
            setAttachments, setIsUploadingAttachment, setMessages,
        });

    const handleChatKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented) return;
        const isComposer = event.target === inputRef.current;
        const scrollDelta = chatScrollDeltaForComposerKey({
            key: event.key,
            value: isComposer ? inputRef.current?.value || '' : '',
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
        pollingEnabled: embedded || (isOpen && !isMinimized),
    });
    const { focusComposerWith, copyMessage, quoteMessage, markMessage, submitMessageFeedback, refreshMessageJob, previousUserPrompt, retryMessage } = useChatMessageActions({
        messages, setMessages, agentName: agentConfig?.name, selectedAgentId, sessionId, isLoading,
        inputRef, setInputValue, setShowMentionMenu,
    });
    const confirmConversationRewind = useChatRewind({
        messages, selectedAgentId, sessionId, notebookId, pendingRewindIndex, isLoading, isRewinding,
        historyHydrationRef, setMessages, setPendingConfirmation, setDetailsMessageIndex,
        setPendingRewindIndex, setIsRewinding, focusComposerWith,
    });


    const agentName = agentConfig?.name || 'Gnosi Copilot';
    const agentIcon = agentConfig?.icon || 'lucide:Brain:white';
    const agentHasModel = Boolean(agentConfig?.provider && agentConfig.model);
    const agentModel = agentHasModel
        ? agentConfig?.modelAlias || agentConfig?.model || ''
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
    const runtimeHelp: Partial<Record<AgentRuntimeStatusKind, string>> = {
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
    };
    const runtimeStatusHelp = runtimeHelp[runtimeStatus.kind] || '';
    const sortedSessions = [...chatSessions]
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const queueScope = `${browserStorageScope}:${selectedAgentId}:${sessionId}:${selectedProfileId}`;
    const [queueState, setQueueState] = useState<{ scope: string; items: readonly QueuedPrompt[] }>({ scope: queueScope, items: restorePromptQueue(queueScope) });
    const [queueStorageError, setQueueStorageError] = useState(false);
    const queueItems = queueState.scope === queueScope ? queueState.items : restorePromptQueue(queueScope);
    if (queueState.scope !== queueScope) setQueueState({ scope: queueScope, items: queueItems });
    const queueRef = useRef({ scope: queueScope, items: queueItems });
    useEffect(() => { queueRef.current = { scope: queueScope, items: queueItems }; }, [queueScope, queueItems]);
    const queueRunningRef = useRef(false);
    const queuedDraftRef = useRef({ inputValue, attachments, selectedMentions });
    useEffect(() => { queuedDraftRef.current = { inputValue, attachments, selectedMentions }; }, [inputValue, attachments, selectedMentions]);
    useEffect(() => {
        const changed = (event: StorageEvent) => {
            if (event.key !== queueStorageKey(queueScope)) return;
            const items = restorePromptQueue(queueScope, false);
            queueRef.current = { scope: queueScope, items };
            setQueueState({ scope: queueScope, items });
        };
        return subscribeWindowEvent('storage', changed);
    }, [queueScope]);
    const replaceQueue = async (mutate: (items: readonly QueuedPrompt[]) => readonly QueuedPrompt[], scope = queueScope) => {
        try {
            const items = await mutatePromptQueue(scope, mutate);
            setQueueStorageError(false);
            if (queueRef.current.scope === scope) {
                queueRef.current = { scope, items };
                setQueueState({ scope, items });
            }
            return true;
        } catch { setQueueStorageError(true); return false; }
    };
    useEffect(() => {
        void mutatePromptQueue(queueScope, current => current.map(item => ({ ...item, status: item.status === 'sending' || item.status === 'uncertain' ? 'uncertain' : 'paused' }))).then(items => {
            if (queueRef.current.scope !== queueScope) return;
            queueRef.current = { scope: queueScope, items };
            setQueueState({ scope: queueScope, items });
        }).catch(() => { setQueueStorageError(true); });
    }, [queueScope]);
    const runTurn = (text: string, files: readonly ChatAttachment[], mentions: readonly AgentChatMention[], turnId?: string, onOutcome?: (success: boolean) => void | Promise<void>) => submitChatTurn({
        t, inputValue: text, attachments: files, readOnly, isLoading, agentHasModel, selectedMentions: mentions,
        processingStartedAtRef, setMessages, setInputValue: turnId ? () => {} : setInputValue,
        clearDraftMentions: turnId ? () => {} : clearDraftMentions,
        clearDraftAttachments: turnId ? () => {} : clearDraftAttachments,
        setShowMentionMenu, setIsLoading, setProcessingPhase, browserStorageScope, selectedAgentId,
        profileId: selectedProfileId, sessionId, activeScopeRef, activeStreamRef, setAgentRuntime,
        confirmationSummary, requestAbortRef, contextRefs, notebookId, inputRef, queuedTurnId: turnId, onOutcome,
    });
    const drainQueue = useEffectEvent(() => {
        if (isLoading || queueRunningRef.current || requestAbortRef.current || readOnly || !agentHasModel || !scopeReady || !sessionId || pendingConfirmation) return;
        const item = queueItems[0];
        if (!item || item.status !== 'pending') return;
        if (!item.text.trim() && !item.attachments.length) return;
        const scope = queueScope;
        queueRunningRef.current = true;
        const send = async () => {
            if (queueRef.current.scope !== scope || activeScopeRef.current !== `${browserStorageScope}:${selectedAgentId}:${sessionId}`) return;
            let claimed: QueuedPrompt | undefined;
            if (!await replaceQueue(stored => {
                const first = stored[0];
                if (!first || first.id !== item.id || first.status !== 'pending') return stored;
                claimed = first;
                return stored.map(value => value.id === first.id ? { ...value, status: 'sending' } : value);
            }, scope) || !claimed) return;
            const prompt = claimed;
            if (queueRef.current.scope !== scope || activeScopeRef.current !== `${browserStorageScope}:${selectedAgentId}:${sessionId}`) {
                await replaceQueue(current => current.map(value => value.id === prompt.id ? { ...value, status: 'paused' } : value), scope);
                return;
            }
            await runTurn(prompt.text, prompt.attachments, prompt.mentions, prompt.id, async success => {
                await replaceQueue(current => success ? current.filter(value => value.id !== prompt.id)
                    : current.map(value => ({ ...value, status: value.id === prompt.id ? 'uncertain' as const : 'paused' as const })), scope);
            });
        };
        // Hold the origin-wide lock through delivery so two chat panels cannot send the same turn.
        const locks = (navigator as { locks?: LockManager }).locks;
        if (!locks) { queueRunningRef.current = false; setQueueStorageError(true); return; }
        void locks.request(`gnosi-prompt:${scope}`, send)
            .finally(() => { queueRunningRef.current = false; });
    });
    useEffect(() => { queueMicrotask(() => { drainQueue(); }); }, [queueState, isLoading, readOnly, agentHasModel, scopeReady, sessionId, pendingConfirmation]);
    const handleSubmit = async (event: Pick<SyntheticEvent, 'preventDefault'>): Promise<void> => {
        event.preventDefault();
        if (readOnly || !agentHasModel || isUploadingAttachment || (!inputValue.trim() && !attachments.length)) return Promise.resolve();
        if (isLoading || queueRunningRef.current || requestAbortRef.current || queueItems.length) {
            if (queueItems.length >= 100) { setQueueStorageError(true); return Promise.resolve(); }
            if (await replaceQueue(current => { if (current.length >= 100) throw new Error('Prompt queue is full'); return [...current, { id: crypto.randomUUID(), text: inputValue, attachments: [...attachments], mentions: [...selectedMentions], profileId: selectedProfileId, status: 'pending' }]; })) {
                if (queuedDraftStillCurrent(queueScope, queueRef.current.scope, { inputValue, attachments, selectedMentions },
                    queuedDraftRef.current, inputRef.current?.value)) {
                    setInputValue(''); clearDraftMentions(); clearDraftAttachments();
                }
            }
            return Promise.resolve();
        }
        if (!notebookId && isLearningRequest(inputValue)) {
            setLearningGoal(inputValue); setLearningScope(`${browserStorageScope}:${selectedAgentId}:${sessionId}`);
            setShowLearning(true); setInputValue(''); return Promise.resolve();
        }
        return runTurn(inputValue, attachments, selectedMentions, undefined, async success => {
            if (!success) await replaceQueue(current => current.map(value => ({ ...value, status: 'paused' })), queueScope);
        });
    };
    const handleVoicePrompt = (text: string) => {
        if (readOnly || !agentHasModel || !scopeReady || !sessionId || !text.trim()) return;
        if (queueItems.length >= 100) { setQueueStorageError(true); return; }
        void replaceQueue(current => { if (current.length >= 100) throw new Error('Prompt queue is full'); return [...current, { id: crypto.randomUUID(), text, attachments: [], mentions: [], profileId: selectedProfileId, status: 'pending' }]; });
    };
    const updateQueuedPrompt = (id: string, text: string) => { void replaceQueue(current => current.map(item => item.id === id && item.status !== 'sending' ? { ...item, text } : item)); };
    const removeQueuedPrompt = (id: string) => { void replaceQueue(current => current.filter(item => item.id !== id || item.status === 'sending')); };
    const moveQueuedPromptBy = (id: string, delta: number) => { void replaceQueue(current => moveQueuedPrompt(current, id, delta)); };
    const resumeQueue = () => { void replaceQueue(current => current.map(item => item.status === 'paused' || (item.status === 'pending' && queueItems.some(value => value.id === item.id && value.status === 'paused')) ? { ...item, status: 'pending' } : item.status === 'sending' && queueItems.some(value => value.id === item.id && value.status === 'uncertain') ? { ...item, status: 'uncertain' } : item)); };

    const cancelResponse = () => {
        const streamId = activeStreamRef.current;
        if (streamId) {
            void cancelChatStream({ streamId, agentId: selectedAgentId, sessionId })
                .catch((error: unknown) => { logChatError('agent-chat-stream-cancel', error); });
        }
        requestAbortRef.current?.abort();
    };
    return {
        handleVoicePrompt, queueItems, queueStorageError, updateQueuedPrompt, removeQueuedPrompt, moveQueuedPromptBy, resumeQueue,
        showLearning, setShowLearning,
        learningGoal: learningScope === `${browserStorageScope}:${selectedAgentId}:${sessionId}` ? learningGoal : '',
        setLearningGoal, sessionId, browserStorageScope,
        t, embedded, readOnly, notebookId, conversationMode, storageIdentity, contextRefs,
        isOpen, isDockOpen, agentIcon, setIsDockOpen, setIsOpen, isMinimized, handleChatKeyDown,
        isLoading, runtimeLimited, agentHasModel, agentName, selectedAgentId, runtimeStatusLabel,
        agentModel, runtimeStatusHelp, agentList, archiveCurrentSession, setIsMinimized,
        setSelectedAgentId: selectProfile, selectedProfileId, setShowSessionsView, messagesContainerRef, showSessionsView,
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
    };
}
