import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useExclusiveFloatingPanel } from '../../../shared/hooks/useExclusiveFloatingPanel';
import { useFloatingActionDock } from '../../../hooks/useFloatingActionDock';
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
}: AgentChatProps) {
    const { t } = useTranslation();
    const defaultSessionTitle = t('chat.default_session_title', 'New conversation');
    const { isOpen, setIsOpen, isMinimized, setIsMinimized } = useChatPanelState(embedded);
    const [messages, setMessages] = useState<readonly StoredChatMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState('');
    const [selectedAgentId, setSelectedAgentId] = useState('gnosy');
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

    const handleSubmit = (event: Pick<SyntheticEvent, 'preventDefault'>) => {
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
    const agentHasModel = Boolean(agentConfig?.provider && agentConfig.model);
    const agentModel = agentHasModel
        ? `${agentConfig?.provider || ''} · ${agentConfig?.model || ''}`
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
    const sortedSessions = chatSessions
        .filter((session) => session.agentId === selectedAgentId)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const cancelResponse = () => {
        const streamId = activeStreamRef.current;
        if (streamId) {
            void cancelChatStream({ streamId, agentId: selectedAgentId, sessionId })
                .catch((error: unknown) => { logChatError('agent-chat-stream-cancel', error); });
        }
        requestAbortRef.current?.abort();
    };
    return {
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
    };
}
