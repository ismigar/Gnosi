import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DynamicIcon, iconNames } from 'lucide-react/dynamic';
import { Send, X, Paperclip, Minimize2, Maximize2, Bot, Brain, Sparkles, Plus, AtSign, Archive, PanelBottomClose, Copy, Reply, RotateCcw, Pencil, ThumbsUp, ThumbsDown, Info, Bookmark, Undo2, Blocks } from 'lucide-react';
import { useConfigChanged } from '../lib/configEvents';
import { announceFloatingPanelOpen, useExclusiveFloatingPanel } from '../hooks/useExclusiveFloatingPanel';
import { useFloatingActionDock } from '../hooks/useFloatingActionDock';
import ConfirmModal from './ConfirmModal';
import {
    agentChatStorageScope,
    confirmationForStorage,
    mergeConfirmationRecords,
    startConfirmationRefresh,
} from './agentConfirmationUtils';
import { chatScrollDeltaForComposerKey } from './agentChatKeyboardUtils';
import {
    boundedProcessingMs,
    boundedJob,
    boundedTransparencyMetadata,
    boundedTurnMetrics,
    conversationRewindPlan,
    mergeCanonicalMessageMetadata,
    processingSeconds,
} from './agentChatMessageUtils';
import { selectedMentionsInText, visibleMentionToken } from './agentChatMentionUtils';
import { deriveAgentRuntimeStatus } from './agentRuntimeStatus';
import { toast } from '../lib/toast';

const CHAT_SESSIONS_KEY = 'agent_chat_sessions_v2';
const CHAT_ACTIVE_SESSION_KEY = 'agent_chat_active_session_id_v2';
const CHAT_SELECTED_AGENT_KEY = 'agent_selected_id_v2';
const CHAT_PENDING_CHECKPOINT_DELETES_KEY = 'agent_pending_checkpoint_deletes_v1';
const MAX_CHAT_ATTACHMENT_SIZE = 15 * 1024 * 1024;
const MAX_CHAT_ATTACHMENTS = 8;
const CHAT_ATTACHMENT_ACCEPT = [
    '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml',
    '.xml', '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.pdf',
].join(',');
const MAX_STORED_SESSIONS = 20;
const MAX_STORED_MESSAGES = 100;
const MAX_STORED_MESSAGE_CHARS = 20_000;
const DYNAMIC_ICON_NAMES = new Set(iconNames);

const lucideIconName = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const confirmationScope = (confirmation, browserStorageScope = '') => {
    if (confirmation?.client_scope) return confirmation.client_scope;
    if (confirmation?.agent_id && confirmation?.session_id) {
        return [
            browserStorageScope,
            confirmation.agent_id,
            confirmation.session_id,
        ].filter(Boolean).join(':');
    }
    return '';
};

const formatConfirmationValue = value => {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }
    return String(value);
};

const boundedChatSessions = (sessions) => [...(Array.isArray(sessions) ? sessions : [])]
    .filter((session) => session && typeof session === 'object' && session.id)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_STORED_SESSIONS)
    .map((session) => ({
        ...session,
        messages: (Array.isArray(session.messages) ? session.messages : [])
            .slice(-MAX_STORED_MESSAGES)
            .map((message) => {
                const transparency = boundedTransparencyMetadata(message);
                return {
                    ...message,
                    content: message?.confirmation
                        ? ''
                        : (
                            typeof message?.content === 'string'
                                ? message.content.slice(0, MAX_STORED_MESSAGE_CHARS)
                                : String(message?.content || '')
                                    .slice(0, MAX_STORED_MESSAGE_CHARS)
                        ),
                    confirmation: confirmationForStorage(message?.confirmation),
                    processingMs: boundedProcessingMs(message?.processingMs),
                    timings: boundedTurnMetrics(message?.timings),
                    ...transparency,
                };
            }),
    }));

const safeLocalStorageSet = (key, value) => {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn('Could not persist assistant chat state', error);
        return false;
    }
};

const createChatSession = (title, agentId = 'gnosy') => ({
    id: crypto.randomUUID(),
    title,
    archived: false,
    agentId,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
});

const deriveSessionTitle = (messages, fallback) => {
    const firstUser = (messages || []).find((m) => m.role === 'user' && String(m.content || '').trim());
    if (!firstUser) return fallback;
    const clean = String(firstUser.content).replace(/@\[[^\]]+\]\([^)]+\)/g, '').trim();
    if (!clean) return fallback;
    return clean.length > 42 ? `${clean.slice(0, 42)}...` : clean;
};

const deleteSessionCheckpoint = async (session) => {
    if (!session?.agentId || !session?.id) return true;
    const response = await fetch(`/api/chat/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.id)}`, {
        method: 'DELETE',
    });
    if (!response.ok) throw new Error(`Checkpoint deletion failed (${response.status})`);
    return true;
};

const AgentChat = ({ storageIdentity = '', contextRefs = [] }) => {
    const { t, i18n } = useTranslation();
    const defaultSessionTitle = t('chat.default_session_title', 'New conversation');
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState('');
    const [agentConfig, setAgentConfig] = useState(null);
    const [agentList, setAgentList] = useState([]);
    const [selectedAgentId, setSelectedAgentId] = useState('gnosy');
    const [isMinimized, setIsMinimized] = useState(false);
    const [chatSessions, setChatSessions] = useState([]);
    const [sessionsHydrated, setSessionsHydrated] = useState(false);
    const [hydratedStorageScope, setHydratedStorageScope] = useState('');
    const [showSessionsView, setShowSessionsView] = useState(false);
    const [mentionCatalog, setMentionCatalog] = useState([]);
    const [mentionResults, setMentionResults] = useState([]);
    const [showMentionMenu, setShowMentionMenu] = useState(false);
    const [mentionAnchorIndex, setMentionAnchorIndex] = useState(-1);
    const [selectedMentions, setSelectedMentions] = useState([]);
    const [attachments, setAttachments] = useState([]);
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
    const [pendingConfirmation, setPendingConfirmation] = useState(null);
    const [agentRuntime, setAgentRuntime] = useState(null);
    const [detailsMessageIndex, setDetailsMessageIndex] = useState(null);
    const [processingElapsedSeconds, setProcessingElapsedSeconds] = useState(0);
    const [pendingRewindIndex, setPendingRewindIndex] = useState(null);
    const [isRewinding, setIsRewinding] = useState(false);
    const [isDockOpen, setIsDockOpen] = useFloatingActionDock();
    useExclusiveFloatingPanel('chat', isOpen, setIsOpen);

    // Ref to scroll to the bottom
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const requestAbortRef = useRef(null);
    const processingStartedAtRef = useRef(null);
    const historyHydrationRef = useRef(0);
    const activeScopeRef = useRef('');
    const activeVaultStorageScope = localStorage.getItem('gnosi_active_vault') || 'default';
    const workspaceStorageScope = localStorage.getItem('gnosi_workspace_id') || 'personal';
    const userStorageScope = (
        storageIdentity
        || localStorage.getItem('gnosi_user_id')
        || 'personal'
    );
    const browserStorageScope = agentChatStorageScope({
        vaultId: activeVaultStorageScope,
        workspaceId: workspaceStorageScope,
        userId: userStorageScope,
    });
    const scopedStorageKey = useCallback(
        (key) => `${key}:${browserStorageScope}`,
        [browserStorageScope],
    );
    const scopeReady = (
        sessionsHydrated
        && hydratedStorageScope === browserStorageScope
    );
    const queueCheckpointDeletion = useCallback((session) => {
        if (!session?.agentId || !session?.id) return;
        const key = scopedStorageKey(CHAT_PENDING_CHECKPOINT_DELETES_KEY);
        let pending;
        try {
            pending = JSON.parse(localStorage.getItem(key) || '[]');
        } catch {
            pending = [];
        }
        const unique = new Map(
            [...pending, { agentId: session.agentId, id: session.id }]
                .map((item) => [`${item.agentId}:${item.id}`, item]),
        );
        safeLocalStorageSet(key, JSON.stringify([...unique.values()]));
    }, [scopedStorageKey]);

    // Init session ID
    useEffect(() => {
        requestAbortRef.current?.abort();
        setPendingConfirmation(null);
        setSessionsHydrated(false);
        setHydratedStorageScope('');
        const savedAgentId = localStorage.getItem(scopedStorageKey(CHAT_SELECTED_AGENT_KEY)) || 'gnosy';
        const sid = localStorage.getItem(scopedStorageKey('agent_session_id_v2'));
        const savedSessionsRaw = localStorage.getItem(scopedStorageKey(CHAT_SESSIONS_KEY));
        const savedActiveSession = localStorage.getItem(scopedStorageKey(CHAT_ACTIVE_SESSION_KEY));

        let parsedSessions;
        try {
            parsedSessions = savedSessionsRaw ? JSON.parse(savedSessionsRaw) : [];
        } catch {
            parsedSessions = [];
        }

        if (!Array.isArray(parsedSessions) || !parsedSessions.length) {
            parsedSessions = [createChatSession(defaultSessionTitle, savedAgentId)];
        }
        const retainedSessions = boundedChatSessions(parsedSessions);
        const retainedIds = new Set(retainedSessions.map((session) => session.id));
        parsedSessions
            .filter((session) => session?.id && !retainedIds.has(session.id))
            .forEach((session) => {
                void deleteSessionCheckpoint(session).catch(
                    (error) => {
                        queueCheckpointDeletion(session);
                        console.warn('Could not delete evicted assistant checkpoint', error);
                    },
                );
            });
        parsedSessions = retainedSessions.map((session) => ({
            ...session,
            agentId: session.agentId || savedAgentId,
            title: (
                ['Nova conversa', 'New conversation', 'Nueva conversación', 'Nouvelle conversation']
                    .includes(session.title)
                && !(session.messages || []).length
            ) ? defaultSessionTitle : session.title,
        }));

        const agentSessions = parsedSessions.filter((session) => session.agentId === savedAgentId);
        if (!agentSessions.length) {
            const fresh = createChatSession(defaultSessionTitle, savedAgentId);
            parsedSessions.unshift(fresh);
            agentSessions.push(fresh);
        }
        const activeFromStorage = savedActiveSession || sid || agentSessions[0].id;
        let activeSession = agentSessions.find((s) => s.id === activeFromStorage);
        if (!activeSession) {
            activeSession = agentSessions.find((s) => !s.archived) || agentSessions[0];
        }

        if (savedAgentId) {
            setSelectedAgentId(savedAgentId);
        }

        // A conversation no longer persists a model override: the selected
        // agent owns its model, instructions, and context as one profile.
        localStorage.removeItem(scopedStorageKey('agent_selected_llm'));

        setChatSessions(parsedSessions);
        setMessages(activeSession.messages || []);
        setSessionId(activeSession.id);
        if (activeSession.id) {
            safeLocalStorageSet(scopedStorageKey(CHAT_ACTIVE_SESSION_KEY), activeSession.id);
            safeLocalStorageSet(scopedStorageKey('agent_session_id_v2'), activeSession.id);
        }

        setHydratedStorageScope(browserStorageScope);
        setSessionsHydrated(true);
    }, [browserStorageScope, defaultSessionTitle, queueCheckpointDeletion, scopedStorageKey]);

    useEffect(() => {
        if (!scopeReady) return;
        const retainedSessions = boundedChatSessions(chatSessions);
        const retainedIds = new Set(retainedSessions.map((session) => session.id));
        const evictedSessions = chatSessions.filter((session) => !retainedIds.has(session.id));
        if (evictedSessions.length) {
            evictedSessions.forEach((session) => {
                void deleteSessionCheckpoint(session).catch(
                    (error) => {
                        queueCheckpointDeletion(session);
                        console.warn('Could not delete evicted assistant checkpoint', error);
                    },
                );
            });
            setChatSessions(retainedSessions);
            return;
        }
        safeLocalStorageSet(
            scopedStorageKey(CHAT_SESSIONS_KEY),
            JSON.stringify(retainedSessions),
        );
    }, [chatSessions, queueCheckpointDeletion, scopeReady, scopedStorageKey]);

    useEffect(() => {
        if (!scopeReady) return;
        const key = scopedStorageKey(CHAT_PENDING_CHECKPOINT_DELETES_KEY);
        let pending = [];
        try {
            pending = JSON.parse(localStorage.getItem(key) || '[]');
        } catch {
            pending = [];
        }
        if (!Array.isArray(pending) || !pending.length) return;
        void (async () => {
            const failed = [];
            for (const session of pending) {
                try {
                    await deleteSessionCheckpoint(session);
                } catch {
                    failed.push(session);
                }
            }
            safeLocalStorageSet(key, JSON.stringify(failed));
        })();
    }, [scopeReady, scopedStorageKey]);

    useEffect(() => {
        if (!scopeReady || !sessionId) return;
        safeLocalStorageSet(scopedStorageKey(CHAT_ACTIVE_SESSION_KEY), sessionId);
        safeLocalStorageSet(scopedStorageKey('agent_session_id_v2'), sessionId);
        setAgentRuntime(null);
    }, [scopeReady, scopedStorageKey, sessionId]);

    useEffect(() => {
        if (!scopeReady) return;
        safeLocalStorageSet(scopedStorageKey(CHAT_SELECTED_AGENT_KEY), selectedAgentId);
        historyHydrationRef.current += 1;
        setAgentRuntime(null);
    }, [scopeReady, scopedStorageKey, selectedAgentId]);

    useEffect(() => {
        if (!scopeReady || !selectedAgentId) return;
        const current = chatSessions.find((session) => session.id === sessionId);
        if (current?.agentId === selectedAgentId) return;
        let target = [...chatSessions]
            .filter((session) => session.agentId === selectedAgentId && !session.archived)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        if (!target) {
            target = createChatSession(defaultSessionTitle, selectedAgentId);
            setChatSessions((prev) => [target, ...prev]);
        }
        setSessionId(target.id);
        setMessages(target.messages || []);
        setSelectedMentions([]);
        setAttachments([]);
    }, [chatSessions, defaultSessionTitle, scopeReady, selectedAgentId, sessionId]);

    useEffect(() => () => requestAbortRef.current?.abort(), []);

    useEffect(() => {
        if (!isLoading || processingStartedAtRef.current === null) {
            setProcessingElapsedSeconds(0);
            return undefined;
        }
        const updateElapsed = () => {
            setProcessingElapsedSeconds(Math.max(
                0,
                Math.floor(
                    (performance.now() - processingStartedAtRef.current) / 1000,
                ),
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

    useEffect(() => {
        if (!scopeReady || !sessionId) return;
        setChatSessions((prev) => prev.map((session) => {
            if (session.id !== sessionId) return session;
            return {
                ...session,
                messages,
                updatedAt: Date.now(),
                title: deriveSessionTitle(messages, session.title || defaultSessionTitle),
            };
        }));
    }, [defaultSessionTitle, messages, scopeReady, sessionId]);

    useEffect(() => {
        const current = inputValue || '';
        const caret = inputRef.current?.selectionStart ?? current.length;
        const left = current.slice(0, caret);
        const match = left.match(/(?:^|\s)@([^\s@]{0,40})$/);

        if (!match) {
            setShowMentionMenu(false);
            setMentionResults([]);
            setMentionAnchorIndex(-1);
            return;
        }

        const query = (match[1] || '').toLowerCase();
        const anchor = caret - query.length - 1;
        const results = mentionCatalog
            .filter((item) => item.search.includes(query))
            .slice(0, 8);

        setMentionAnchorIndex(anchor);
        setMentionResults(results);
        setShowMentionMenu(results.length > 0);
    }, [inputValue, mentionCatalog]);

    useEffect(() => {
        if (!inputRef.current) return;
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }, [inputValue]);

    const loadConfig = useCallback(async () => {
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                const data = await res.json();
                const ai = data.ai || {};
                const activeId = ai.active_agent_id;
                // Disabled profiles stay editable in Settings but are not
                // selectable for a conversation. This also keeps a newly
                // created LLM Wiki profile with no model from falling back to
                // an unrelated provider before the user configures it.
                const agents = (ai.agents || []).filter((agent) => agent.enabled !== false);
                setAgentList(agents);
                const currentId = selectedAgentId || activeId;
                const agent = agents.find((a) => a.id === currentId) || agents.find((a) => a.id === activeId) || agents[0];
                if (agent) {
                    setAgentConfig(agent);
                    setSelectedAgentId(agent.id);
                }
            }
        } catch (e) {
            console.error("Error loading agent config", e);
        }
    }, [selectedAgentId]);

    // Re-fetch when the Settings modals emit the event (without a reload).
    useConfigChanged(loadConfig);

    useEffect(() => {
        if (!agentList.length) return;
        const next = agentList.find((a) => a.id === selectedAgentId) || agentList[0];
        if (next) {
            setAgentConfig(next);
            if (next.id !== selectedAgentId) {
                setSelectedAgentId(next.id);
            }
        }
    }, [selectedAgentId, agentList]);

    const loadMentionCatalog = useCallback(async () => {
        try {
            const [pagesRes, tablesRes, dbsRes] = await Promise.all([
                fetch('/api/vault/pages'),
                fetch('/api/vault/tables'),
                fetch('/api/vault/databases'),
            ]);

            const [pages, tables, dbs] = await Promise.all([
                pagesRes.ok ? pagesRes.json() : [],
                tablesRes.ok ? tablesRes.json() : [],
                dbsRes.ok ? dbsRes.json() : [],
            ]);

            const pageItems = (Array.isArray(pages) ? pages : []).map((p) => {
                const label = p.title || p.name || p.id;
                return {
                    id: String(p.id),
                    type: 'page',
                    label: String(label),
                    subtitle: t('chat.mention_type_page', "Page"),
                    search: `page ${label} ${p.id}`.toLowerCase(),
                };
            });

            const tableItems = (Array.isArray(tables) ? tables : []).map((tbl) => {
                const label = tbl.name || tbl.title || tbl.id;
                return {
                    id: String(tbl.id),
                    type: 'table',
                    label: String(label),
                    subtitle: t('chat.mention_type_table', "Table"),
                    search: `table ${label} ${tbl.id}`.toLowerCase(),
                };
            });

            const dbItems = (Array.isArray(dbs) ? dbs : []).map((d) => {
                const label = d.name || d.title || d.id;
                return {
                    id: String(d.id),
                    type: 'database',
                    label: String(label),
                    subtitle: t('chat.mention_type_database', "DB"),
                    search: `database bd ${label} ${d.id}`.toLowerCase(),
                };
            });

            setMentionCatalog([...pageItems, ...tableItems, ...dbItems]);
        } catch (e) {
            console.error('Error loading mention catalog', e);
        }
    }, [t]);

    useEffect(() => {
        void loadConfig();
        void loadMentionCatalog();
    }, [loadConfig, loadMentionCatalog]);

    const selectSession = async (nextId) => {
        if (isLoading) return;
        const target = chatSessions.find((s) => s.id === nextId);
        if (!target) return;
        const hydrationId = historyHydrationRef.current + 1;
        historyHydrationRef.current = hydrationId;
        setAgentRuntime(null);
        setChatSessions((prev) => prev.map((s) => s.id === nextId ? { ...s, archived: false, updatedAt: Date.now() } : s));
        setSessionId(target.id);
        setMessages(target.messages || []);
        setShowSessionsView(false);
        try {
            const response = await fetch(
                `/api/chat/sessions/${encodeURIComponent(target.agentId)}/${encodeURIComponent(target.id)}`,
            );
            if (response.ok) {
                const canonical = await response.json();
                if (historyHydrationRef.current !== hydrationId) return;
                if (Array.isArray(canonical.messages) && canonical.messages.length) {
                    const hydratedMessages = mergeCanonicalMessageMetadata(
                        canonical.messages,
                        target.messages,
                    );
                    setMessages(hydratedMessages);
                    setChatSessions((prev) => prev.map((session) => (
                        session.id === target.id
                            ? { ...session, messages: hydratedMessages }
                            : session
                    )));
                }
            }
        } catch (error) {
            console.warn('Could not load canonical assistant history', error);
        }
    };

    const archiveCurrentSession = () => {
        if (!sessionId) return;
        setChatSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, archived: true, updatedAt: Date.now() } : s));
    };

    const createNewSession = () => {
        if (isLoading) return;
        historyHydrationRef.current += 1;
        const next = createChatSession(defaultSessionTitle, selectedAgentId);
        setChatSessions((prev) => [
            next,
            ...prev.map((s) => s.id === sessionId ? { ...s, archived: true, updatedAt: Date.now() } : s),
        ]);
        setSessionId(next.id);
        setMessages([]);
        setAgentRuntime(null);
        setInputValue('');
        setSelectedMentions([]);
        setShowSessionsView(false);
    };

    const deleteSessionById = async (targetId) => {
        if (!targetId || isLoading) return;
        historyHydrationRef.current += 1;
        const target = chatSessions.find((session) => session.id === targetId);
        try {
            await deleteSessionCheckpoint(target);
        } catch (error) {
            console.warn('Could not delete assistant checkpoint', error);
            return;
        }

        const remaining = chatSessions.filter((s) => s.id !== targetId);
        const remainingForAgent = remaining.filter((s) => s.agentId === selectedAgentId);
        if (!remainingForAgent.length) {
            const fresh = createChatSession(defaultSessionTitle, selectedAgentId);
            setChatSessions([fresh, ...remaining]);
            setSessionId(fresh.id);
            setMessages([]);
            setInputValue('');
            setSelectedMentions([]);
            return;
        }

        setChatSessions(remaining);

        if (targetId === sessionId) {
            const nextSession = remainingForAgent[0];
            setSessionId(nextSession.id);
            setMessages(nextSession.messages || []);
        }
    };

    const applyMention = (item) => {
        const current = inputValue || '';
        const caret = inputRef.current?.selectionStart ?? current.length;
        if (mentionAnchorIndex < 0 || mentionAnchorIndex > caret) return;

        const token = `${visibleMentionToken(item.label)} `;
        const before = current.slice(0, mentionAnchorIndex);
        const after = current.slice(caret);
        const nextValue = `${before}${token}${after}`;
        const nextCaret = before.length + token.length;

        setInputValue(nextValue);
        setSelectedMentions((previous) => [
            ...previous.filter((mention) => mention.token !== token.trim()),
            {
                type: item.type,
                id: item.id,
                label: item.label,
                token: token.trim(),
            },
        ]);
        setShowMentionMenu(false);
        setMentionResults([]);
        setMentionAnchorIndex(-1);

        requestAnimationFrame(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.setSelectionRange(nextCaret, nextCaret);
            }
        });
    };

    const handlePickAttachment = () => {
        if (isUploadingAttachment) return;
        fileInputRef.current?.click();
    };

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

    const uploadAttachmentFile = async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('agent_id', selectedAgentId);
        formData.append('session_id', sessionId);

        const res = await fetch('/api/chat/attachments', {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            const detail = await res.text();
            throw new Error(detail || t('chat.attachment_upload_failed', "The file could not be uploaded"));
        }

        const data = await res.json();
        return {
            id: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            type: file.type,
            path: data.path || null,
            url: null,
        };
    };

    const handleAttachmentInputChange = async (e) => {
        const picked = Array.from(e.target.files || []);
        e.target.value = '';
        if (!picked.length) return;

        const remainingSlots = Math.max(0, MAX_CHAT_ATTACHMENTS - attachments.length);
        const validFiles = picked
            .filter((file) => file.size <= MAX_CHAT_ATTACHMENT_SIZE)
            .slice(0, remainingSlots);
        const skipped = picked.length - validFiles.length;
        if (skipped > 0) {
            setMessages((prev) => [
                ...prev,
                { role: 'system', content: t('chat.attachments_skipped_limits', "Notice: {{count}} file(s) exceed the size or count limit and were not attached.", { count: skipped }) },
            ]);
        }
        if (!validFiles.length) return;

        setIsUploadingAttachment(true);
        const uploaded = [];
        try {
            for (const file of validFiles) {
                const saved = await uploadAttachmentFile(file);
                uploaded.push(saved);
            }
            setAttachments((prev) => [...prev, ...uploaded]);
        } catch (error) {
            for (const item of uploaded) {
                void fetch('/api/chat/attachments', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: item.path, agent_id: selectedAgentId, session_id: sessionId }),
                }).catch(() => {});
            }
            setMessages((prev) => [...prev, { role: 'system', content: t('chat.attachment_upload_error', "Error uploading attachment: {{message}}", { message: error.message }) }]);
        } finally {
            setIsUploadingAttachment(false);
        }
    };

    const removeAttachment = (attachmentId) => {
        const target = attachments.find((item) => item.id === attachmentId);
        setAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
        if (target?.path) {
            void fetch('/api/chat/attachments', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: target.path, agent_id: selectedAgentId, session_id: sessionId }),
            }).catch((error) => console.warn('Could not delete abandoned chat attachment', error));
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen, isMinimized]);

    const confirmationTitle = useCallback((confirmation) => t(
        confirmation?.title_key || 'chat.confirmations.title',
        'Confirm action',
        confirmation?.details || {},
    ), [t]);

    const confirmationSummary = useCallback((confirmation) => t(
        confirmation?.summary_key || 'chat.confirmations.summary',
        'Review this action before continuing.',
        confirmation?.details || {},
    ), [t]);

    const confirmationReview = useCallback(confirmation => {
        const details = Object.entries(confirmation?.details || {});
        const renderDetailValue = (key, value) => {
            if (key === 'updates' && Array.isArray(value)) {
                return (
                    <div style={{ display: 'grid', gap: '6px' }}>
                        {value.map((update, index) => (
                            <div key={`${update?.id || 'row'}-${index}`} style={{ padding: '6px 8px', borderRadius: '6px', background: 'var(--bg-secondary)' }}>
                                <strong>{update?.title || update?.id || t('chat.confirmations.row_fallback', 'Row {{count}}', { count: index + 1 })}</strong>
                                {update?.properties && <div style={{ marginTop: '2px', fontSize: '0.75rem' }}>{formatConfirmationValue(update.properties)}</div>}
                                {update?.from && update?.to && (
                                    <div style={{ marginTop: '2px', fontSize: '0.75rem' }}>
                                        {update.from} → {update.to}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                );
            }
            return formatConfirmationValue(value);
        };
        return (
            <div>
                <p style={{ margin: '0 0 12px' }}>
                    {confirmationSummary(confirmation)}
                </p>
                {details.length > 0 && (
                    <dl style={{
                        display: 'grid',
                        gap: '8px',
                        margin: 0,
                        maxHeight: '45vh',
                        overflowY: 'auto',
                    }}>
                        {details.map(([key, value]) => (
                            <div key={key}>
                                <dt style={{
                                    color: 'var(--text-primary)',
                                    fontWeight: 700,
                                    fontSize: '0.72rem',
                                }}>
                                    {t(
                                        `chat.confirmations.details.${key}`,
                                        key.replaceAll('_', ' '),
                                    )}
                                </dt>
                                <dd style={{
                                    margin: '2px 0 0',
                                    whiteSpace: 'pre-wrap',
                                    overflowWrap: 'anywhere',
                                    fontFamily: key === 'body' || key === 'arguments'
                                        ? 'monospace'
                                        : 'inherit',
                                }}>
                                    {renderDetailValue(key, value)}
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>
        );
    }, [confirmationSummary, t]);

    const updateConfirmationStatus = useCallback((confirmationId, status) => {
        const terminal = [
            'cancelled',
            'completed',
            'expired',
            'failed',
            'outcome_unknown',
            'partial',
        ].includes(status);
        setMessages((prev) => prev.map((message) => (
            message?.confirmation?.confirmation_id === confirmationId
                ? {
                    ...message,
                    confirmation: {
                        ...message.confirmation,
                        status,
                        ...(terminal ? {
                            details: {},
                            summary_key: 'chat.confirmations.summary',
                            destructive: false,
                        } : {}),
                    },
                }
                : message
        )));
    }, []);

    useEffect(() => {
        if (!scopeReady || !selectedAgentId || !sessionId) return undefined;
        const requestScope = `${browserStorageScope}:${selectedAgentId}:${sessionId}`;
        const controller = new AbortController();
        let inFlight = false;
        const params = new URLSearchParams({
            agent_id: selectedAgentId,
            session_id: sessionId,
        });
        const refreshConfirmations = () => {
            if (inFlight || controller.signal.aborted) return;
            inFlight = true;
            void fetch(`/api/chat/confirmations?${params.toString()}`, {
                signal: controller.signal,
            })
                .then(async response => {
                    if (!response.ok) return null;
                    return response.json();
                })
                .then(payload => {
                    if (
                        !payload
                        || controller.signal.aborted
                        || activeScopeRef.current !== requestScope
                    ) return;
                    const records = (payload.confirmations || []).map(item => ({
                        ...item,
                        client_scope: requestScope,
                        agent_id: selectedAgentId,
                        session_id: sessionId,
                    }));
                    setMessages(prev => mergeConfirmationRecords(
                        prev,
                        records,
                        confirmationSummary,
                    ));
                })
                .catch(error => {
                    if (error.name !== 'AbortError') {
                        console.error('Could not refresh pending agent actions', error);
                    }
                })
                .finally(() => {
                    inFlight = false;
                });
        };
        const stopRefreshing = startConfirmationRefresh(
            refreshConfirmations,
            window.setInterval.bind(window),
            window.clearInterval.bind(window),
        );
        return () => {
            stopRefreshing();
            controller.abort();
        };
    }, [
        confirmationSummary,
        browserStorageScope,
        scopeReady,
        selectedAgentId,
        sessionId,
    ]);

    const localizedConfirmationError = useCallback((payload, fallback) => {
        const code = payload?.detail?.code || payload?.code || '';
        if (!code) return fallback;
        return t(
            `chat.confirmations.errors.${code}`,
            fallback,
        );
    }, [t]);

    const fetchConfirmationStatus = useCallback(async confirmation => {
        const agentId = confirmation?.agent_id || selectedAgentId;
        const chatSessionId = confirmation?.session_id || sessionId;
        const params = new URLSearchParams({
            agent_id: agentId,
            session_id: chatSessionId,
        });
        const response = await fetch(
            `/api/chat/confirmations/${encodeURIComponent(confirmation.confirmation_id)}?${params.toString()}`,
        );
        if (!response.ok) return null;
        return response.json();
    }, [selectedAgentId, sessionId]);

    const confirmPendingAction = useCallback(async () => {
        const confirmation = pendingConfirmation;
        if (!confirmation?.confirmation_id) return;
        const agentId = confirmation.agent_id || selectedAgentId;
        const chatSessionId = confirmation.session_id || sessionId;
        const requestScope = confirmationScope(
            confirmation,
            browserStorageScope,
        ) || `${browserStorageScope}:${agentId}:${chatSessionId}`;
        let response;
        try {
            response = await fetch(
                `/api/chat/confirmations/${encodeURIComponent(confirmation.confirmation_id)}/confirm`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        agent_id: agentId,
                        session_id: chatSessionId,
                    }),
                },
            );
        } catch (error) {
            console.error('Could not confirm pending agent action', error);
            let recovered = null;
            try {
                recovered = await fetchConfirmationStatus(confirmation);
            } catch (statusError) {
                console.error('Could not reconcile pending agent action', statusError);
            }
            setPendingConfirmation(null);
            if (activeScopeRef.current !== requestScope) return;
            const recoveredStatus = recovered?.status || 'outcome_unknown';
            updateConfirmationStatus(
                confirmation.confirmation_id,
                recoveredStatus,
            );
            const recoveredResult = recovered?.result || {};
            let recoveredMessage;
            if (recoveredStatus === 'completed') {
                recoveredMessage = t(
                    'chat.confirmations.completed',
                    'Action completed after confirmation.',
                );
            } else if (recoveredStatus === 'partial') {
                recoveredMessage = t(
                    'chat.confirmations.partial',
                    'The action completed partially: {{completed}} completed, {{failed}} failed.',
                    {
                        completed: recoveredResult.purged_count
                            || recoveredResult.updated_count
                            || 0,
                        failed: recoveredResult.failed_count
                            || recoveredResult.rollback_failed_ids?.length
                            || 0,
                    },
                );
            } else if (recoveredStatus === 'outcome_unknown') {
                recoveredMessage = t(
                    'chat.confirmations.outcome_unknown',
                    'The connection was lost and the action outcome is unknown. Check the target before trying again.',
                );
            } else {
                recoveredMessage = t(
                    `chat.confirmations.status.${recoveredStatus}`,
                    recoveredStatus,
                );
            }
            setMessages((prev) => [...prev, {
                role: 'system',
                content: recoveredMessage,
            }]);
            return;
        }
        let payload = {};
        try {
            payload = await response.json();
        } catch {
            payload = {};
        }
        if (!response.ok) {
            let authoritative = payload;
            try {
                authoritative = (
                    await fetchConfirmationStatus(confirmation)
                ) || payload;
            } catch (statusError) {
                console.error('Could not reconcile failed agent action', statusError);
            }
            setPendingConfirmation(null);
            if (activeScopeRef.current !== requestScope) return;
            const status = authoritative?.status || (
                payload?.detail?.code === 'confirmation_outcome_unknown'
                    ? 'outcome_unknown'
                    : 'failed'
            );
            updateConfirmationStatus(confirmation.confirmation_id, status);
            const fallback = response.statusText || t(
                'chat.confirmations.errors.confirmation_action_failed',
                'The action could not be completed.',
            );
            setMessages((prev) => [...prev, {
                role: 'system',
                content: localizedConfirmationError(payload, fallback),
            }]);
            return;
        }
        const status = payload.status || 'completed';
        setPendingConfirmation(null);
        if (activeScopeRef.current !== requestScope) return;
        updateConfirmationStatus(confirmation.confirmation_id, status);
        const result = payload.result || {};
        setMessages((prev) => [...prev, {
            role: 'system',
            content: status === 'partial'
                ? t(
                    'chat.confirmations.partial',
                    'The action completed partially: {{completed}} completed, {{failed}} failed.',
                    {
                        completed: result.purged_count || result.updated_count || 0,
                        failed: result.failed_count || result.rollback_failed_ids?.length || 0,
                    },
                )
                : t(
                    'chat.confirmations.completed',
                    'Action completed after confirmation.',
                ),
        }]);
    }, [
        browserStorageScope,
        fetchConfirmationStatus,
        localizedConfirmationError,
        pendingConfirmation,
        selectedAgentId,
        sessionId,
        t,
        updateConfirmationStatus,
    ]);

    const cancelPendingAction = useCallback(async () => {
        const confirmation = pendingConfirmation;
        setPendingConfirmation(null);
        if (!confirmation?.confirmation_id) return;
        const agentId = confirmation.agent_id || selectedAgentId;
        const chatSessionId = confirmation.session_id || sessionId;
        const requestScope = confirmationScope(
            confirmation,
            browserStorageScope,
        ) || `${browserStorageScope}:${agentId}:${chatSessionId}`;
        try {
            const response = await fetch(
                `/api/chat/confirmations/${encodeURIComponent(confirmation.confirmation_id)}/cancel`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        agent_id: agentId,
                        session_id: chatSessionId,
                    }),
                },
            );
            if (activeScopeRef.current !== requestScope) return;
            let status = response.ok ? 'cancelled' : 'pending';
            if (!response.ok) {
                try {
                    const authoritative = await fetchConfirmationStatus(
                        confirmation,
                    );
                    status = authoritative?.status || status;
                } catch (statusError) {
                    console.error(
                        'Could not reconcile cancelled agent action',
                        statusError,
                    );
                }
            }
            if (activeScopeRef.current !== requestScope) return;
            updateConfirmationStatus(
                confirmation.confirmation_id,
                status,
            );
        } catch (error) {
            console.error('Could not cancel pending agent action', error);
            if (activeScopeRef.current !== requestScope) return;
            let status = 'pending';
            try {
                const authoritative = await fetchConfirmationStatus(
                    confirmation,
                );
                status = authoritative?.status || status;
            } catch (statusError) {
                console.error(
                    'Could not reconcile pending cancellation',
                    statusError,
                );
            }
            if (activeScopeRef.current !== requestScope) return;
            updateConfirmationStatus(confirmation.confirmation_id, status);
        }
    }, [
        browserStorageScope,
        fetchConfirmationStatus,
        pendingConfirmation,
        selectedAgentId,
        sessionId,
        updateConfirmationStatus,
    ]);

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
            const response = await fetch('/api/chat/feedback', {
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
                    duration_ms: message.timings?.total_ms || message.processingMs || 0,
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
            const response = await fetch(
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

    const confirmConversationRewind = useCallback(async () => {
        if (pendingRewindIndex === null || isLoading || isRewinding) return;
        const plan = conversationRewindPlan(messages, pendingRewindIndex);
        if (!plan) return;

        setIsRewinding(true);
        try {
            const response = await fetch(
                `/api/chat/sessions/${encodeURIComponent(selectedAgentId)}/${encodeURIComponent(sessionId)}/rewind`,
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
        pendingRewindIndex,
        selectedAgentId,
        sessionId,
        t,
    ]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if ((!inputValue.trim() && attachments.length === 0) || isLoading || !agentHasModel) return;

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
        const requestScope = `${browserStorageScope}:${selectedAgentId}:${sessionId}`;
        let turnMetrics = null;
        let turnTransparency = boundedTransparencyMetadata({});

        try {
            requestAbortRef.current?.abort();
            const controller = new AbortController();
            requestAbortRef.current = controller;
            const response = await fetch('/api/chat', {
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

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let aiMsgAdded = false;
            let buffer = '';
            let selectedLlm = null;
            let terminalReceived = false;
            let responseReceived = false;
            let streamDone = false;

            while (!streamDone) {
                const { done, value } = await reader.read();
                streamDone = done;

                // We accumulate in the buffer and only process COMPLETE lines: a line
                // JSON can end up split across two network chunks (losing the
                // entire message if you try to parse it in pieces). `{ stream: !done }`
                // also avoids corrupting a multibyte UTF-8 character (à, é, ç…) cut
                // at the chunk boundary.
                buffer += decoder.decode(value, { stream: !done });
                const lines = buffer.split('\n');
                // While the stream continues, the last line may be incomplete and
                // we keep it in the buffer; by the time it's done everything has already been processed.
                buffer = done ? '' : lines.pop();

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);

                        if (data.type === 'llm_selected') {
                            selectedLlm = {
                                mode: data.mode || 'agent_default',
                                provider: data.provider,
                                model: data.model,
                            };
                            continue;
                        }
                        if (data.type === 'agent_runtime') {
                            setAgentRuntime(data);
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
                            }
                            newMsgs[lastIdx] = lastMsg;
                            return newMsgs;
                        });
                    } catch (e) {
                        console.error("Error parsing JSON line:", line, e);
                    }
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
            if (error.name !== 'AbortError' && activeScopeRef.current === requestScope) {
                const errorMessage = typeof error.message === 'string'
                    ? error.message.trim()
                    : '';
                setMessages(prev => [...prev, {
                    role: 'system',
                    content: `${t('chat.error_prefix', 'Error')}: ${errorMessage || t('errors.unknown', 'Unknown error')}`,
                    turnId,
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
            processingStartedAtRef.current = null;
            setIsLoading(false);
            if (inputRef.current) {
                inputRef.current.style.height = 'auto';
            }
        }
    };

    const renderIcon = (iconStr, size = 20) => {
        if (!iconStr) return <Bot size={size} />;
        if (iconStr.startsWith('lucide:')) {
            const [_, name, colorName] = iconStr.split(':');
            // Support 'white', 'gray', or any color name. Fallback to white for Brain if no color.
            const color = colorName || (name === 'Brain' ? 'white' : 'currentColor');
            const normalizedName = lucideIconName(name || '');
            return DYNAMIC_ICON_NAMES.has(normalizedName)
                ? <DynamicIcon name={normalizedName} size={size} color={color} />
                : <Bot size={size} />;
        }
        return <span style={{ fontSize: `${size}px` }}>{iconStr}</span>;
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

    if (!isOpen) {
        return (
            <>
            <button
                type="button"
                onClick={() => setIsDockOpen(!isDockOpen)}
                className="gnosi-floating-dock-toggle flex items-center justify-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] shadow-sm transition-colors hover:text-[var(--gnosi-primary)]"
                aria-label={isDockOpen ? t('common.close', 'Close') : t('chat.open_chat', 'Open chat')}
                title={isDockOpen ? t('common.close', 'Close') : t('chat.open_chat', 'Open chat')}
                aria-expanded={isDockOpen}
            >
                {isDockOpen ? <PanelBottomClose size={18} /> : <Plus size={20} />}
            </button>
            <button
                onClick={() => {
                    announceFloatingPanelOpen('chat');
                    setIsDockOpen(false);
                    setIsOpen(true);
                }}
                className="premium-chat-trigger gnosi-floating-action gnosi-floating-action--chat"
                aria-label={t('chat.open_chat', "Open chat")}
                title={t('chat.open_chat', "Open chat")}
                style={{
                    borderRadius: '50%',
                    background: 'var(--gnosi-blue, #3b82f6)',
                    color: 'white', border: 'none', cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s ease'
                }}
            >
                {renderIcon(agentIcon, 20)}
            </button>
            </>
        );
    }

    return (
        <div
            className="gnosi-floating-panel gnosi-floating-panel--chat"
            tabIndex={0}
            onKeyDown={handleChatKeyDown}
            style={{
            position: 'fixed', bottom: 'max(16px, env(safe-area-inset-bottom))', right: 'max(16px, env(safe-area-inset-right))', zIndex: 'var(--z-floating)',
            width: isMinimized ? '200px' : 'min(400px, calc(100vw - 2rem))',
            height: isMinimized ? '50px' : '600px',
            maxHeight: 'calc(100vh - 100px)',
            backgroundColor: 'var(--bg-primary, white)',
            borderRadius: '20px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            border: '1px solid var(--settings-border, #e5e7eb)',
            transition: 'all 0.3s ease-in-out'
            }}
        >
            {/* Header */}
            <div style={{
                padding: '12px 16px', 
                background: 'var(--settings-header-bg, #f9fafb)', 
                borderBottom: '1px solid var(--settings-border, #e5e7eb)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                cursor: 'pointer'
            }} onClick={() => isMinimized && setIsMinimized(false)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ 
                        width: '32px', height: '32px', borderRadius: '8px', 
                        background: 'rgba(37, 99, 235, 0.1)', color: 'var(--gnosi-blue)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        {renderIcon(agentIcon, 18)}
                    </div>
                    <div>
                        <select
                            value={selectedAgentId}
                            onChange={(e) => setSelectedAgentId(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            disabled={isLoading}
                            style={{
                                margin: 0,
                                width: 'auto',
                                maxWidth: '190px',
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--text-primary)',
                                fontSize: '0.9rem',
                                fontWeight: '700',
                                padding: 0,
                                outline: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            {agentList.map((a) => (
                                <option key={a.id} value={a.id}>{a.name || a.id}</option>
                            ))}
                        </select>
                        {!isMinimized && <div style={{ fontSize: '0.7rem', color: runtimeLimited ? '#f59e0b' : (agentHasModel ? '#10b981' : '#ef4444'), display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: runtimeLimited ? '#f59e0b' : (agentHasModel ? '#10b981' : '#ef4444') }}></span>
                            {runtimeStatusLabel}
                            {agentHasModel && <span style={{ color: 'var(--text-secondary)' }}>· {t('chat.agent_model', 'Model: {{model}}', { model: agentModel })}</span>}
                        </div>}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }} aria-label={isMinimized ? t('chat.expand_chat', "Expand chat") : t('chat.minimize_chat', "Minimize chat")} title={isMinimized ? t('chat.expand_chat', "Expand chat") : t('chat.minimize_chat', "Minimize chat")} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                        {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); archiveCurrentSession(); setShowSessionsView(false); setIsOpen(false); }} aria-label={t('chat.close_chat', "Close chat")} title={t('chat.close_chat', "Close chat")} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                        <X size={18} />
                    </button>
                </div>
            </div>

            {!isMinimized && runtimeLimited && (
                <div
                    role="status"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 16px',
                        borderBottom: '1px solid var(--settings-border, #e5e7eb)',
                        background: 'color-mix(in srgb, #f59e0b 12%, var(--bg-primary))',
                        color: 'var(--text-primary)',
                        fontSize: '0.75rem',
                    }}
                >
                    <Info size={15} aria-hidden="true" style={{ flexShrink: 0, color: '#f59e0b' }} />
                    <span style={{ flex: 1 }}>{runtimeStatusHelp}</span>
                    <button
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent('open-settings', { detail: 'ai' }))}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--gnosi-blue)',
                            cursor: 'pointer',
                            padding: 0,
                            font: 'inherit',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {t('chat.runtime_review_settings', 'Review settings')}
                    </button>
                </div>
            )}

            {!isMinimized && (
                <>
                    {/* Missatges */}
                    <div ref={messagesContainerRef} style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {showSessionsView && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <h4 style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-primary)' }}>{t('chat.sessions', 'Sessions')}</h4>
                                    <button
                                        onClick={() => setShowSessionsView(false)}
                                        style={{ border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '10px', height: '24px', padding: '0 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                                    >
                                        {t('chat.back', "Back")}
                                    </button>
                                </div>

                                {sortedSessions.length === 0 && (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{t('chat.no_sessions', "There are no sessions.")}</div>
                                )}

                                {sortedSessions.map((s) => (
                                    <div key={s.id} style={{ border: '1px solid var(--settings-border, #e5e7eb)', borderRadius: '12px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || t('chat.session_fallback_name', "Session")}</div>
                                            <div style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>{t('chat.messages_count', { count: (s.messages || []).length, defaultValue_one: "{{count}} message", defaultValue_other: "{{count}} messages" })}{s.archived ? ` · ${t('chat.archived_suffix', "archived")}` : ''}</div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <button
                                                onClick={() => selectSession(s.id)}
                                                style={{ border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '10px', height: '24px', padding: '0 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                                            >
                                                {t('chat.open_session', "Open")}
                                            </button>
                                            <button
                                                onClick={() => deleteSessionById(s.id)}
                                                aria-label={t('chat.delete_session_aria', "Delete session {{title}}", { title: s.title || t('common.untitled') })}
                                                title={t('chat.delete_session_title', "Delete session")}
                                                style={{ border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '10px', width: '24px', height: '24px', fontSize: '0.7rem', cursor: 'pointer', lineHeight: 1 }}
                                            >
                                                x
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
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
                                        <details style={{ marginTop: '10px', whiteSpace: 'normal' }}>
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
                                                                        style={{ color: 'var(--gnosi-blue, #2563eb)', textDecoration: 'underline' }}
                                                                    >
                                                                        {source.title}
                                                                    </a>
                                                                ) : (
                                                                    <span key={source.citation_id} title={t('chat.citation_link_unavailable', 'This evidence has no direct link.')}>
                                                                        {source.title}
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
                                    <button type="button" onClick={() => quoteMessage(msg)} aria-label={t('chat.reply_to_message', 'Reply to message')} title={t('chat.reply_to_message', 'Reply to message')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Reply size={13} /></button>
                                    {msg.role === 'user' && (
                                        <button type="button" onClick={() => focusComposerWith(msg.content || '')} aria-label={t('chat.edit_message', 'Edit and resend')} title={t('chat.edit_message', 'Edit and resend')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Pencil size={13} /></button>
                                    )}
                                    {msg.role === 'assistant' && previousUserPrompt(idx) && (
                                        <button type="button" onClick={() => focusComposerWith(previousUserPrompt(idx))} aria-label={t('chat.regenerate_message', 'Regenerate response')} title={t('chat.regenerate_message', 'Regenerate response')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><RotateCcw size={13} /></button>
                                    )}
                                    {msg.role === 'assistant' && (
                                        <>
                                            <button type="button" onClick={() => submitMessageFeedback(idx, 'up')} aria-label={t('chat.helpful_response', 'Helpful response')} title={t('chat.helpful_response', 'Helpful response')} aria-pressed={msg.feedback === 'up'} style={{ background: 'none', border: 'none', color: msg.feedback === 'up' ? 'var(--gnosi-blue, #2563eb)' : 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><ThumbsUp size={13} /></button>
                                            <button type="button" onClick={() => submitMessageFeedback(idx, 'down')} aria-label={t('chat.unhelpful_response', 'Unhelpful response')} title={t('chat.unhelpful_response', 'Unhelpful response')} aria-pressed={msg.feedback === 'down'} style={{ background: 'none', border: 'none', color: msg.feedback === 'down' ? 'var(--status-error, #dc2626)' : 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><ThumbsDown size={13} /></button>
                                            <button type="button" onClick={() => markMessage(idx, 'saved', !msg.saved)} aria-label={t('chat.save_message', 'Save message')} title={t('chat.save_message', 'Save message')} aria-pressed={Boolean(msg.saved)} style={{ background: 'none', border: 'none', color: msg.saved ? 'var(--gnosi-blue, #2563eb)' : 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Bookmark size={13} fill={msg.saved ? 'currentColor' : 'none'} /></button>
                                        </>
                                    )}
                                    {msg.undo?.available && idx === messages.length - 1 && (
                                        <button type="button" onClick={msg.undo.run} aria-label={t('chat.undo_last_action', 'Undo last action')} title={t('chat.undo_last_action', 'Undo last action')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Undo2 size={13} /></button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setPendingRewindIndex(idx)}
                                        disabled={isLoading || isRewinding}
                                        aria-label={t('chat.rewind_from_message', 'Undo from this message')}
                                        title={t('chat.rewind_from_message', 'Undo from this message')}
                                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: isLoading || isRewinding ? 'default' : 'pointer', padding: '3px', opacity: isLoading || isRewinding ? 0.45 : 1 }}
                                    >
                                        <Undo2 size={13} />
                                    </button>
                                    <button type="button" onClick={() => setDetailsMessageIndex(detailsMessageIndex === idx ? null : idx)} aria-label={t('chat.message_details', 'Message details')} title={t('chat.message_details', 'Message details')} aria-expanded={detailsMessageIndex === idx} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px' }}><Info size={13} /></button>
                                </div>
                                {detailsMessageIndex === idx && (
                                    <div style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', margin: '0 4px', padding: '6px 8px', borderRadius: '8px', background: 'var(--settings-sidebar-bg, #f3f4f6)', color: 'var(--text-secondary)', fontSize: '0.68rem' }}>
                                        {msg.llm?.model && <div>{t('chat.agent_model', 'Model: {{model}}', { model: msg.llm.model })}</div>}
                                        {msg.timings && (
                                            <>
                                                <div>{t('chat.timing_total', 'Server total: {{count}} ms', { count: msg.timings.total_ms ?? 0 })}</div>
                                                <div>{t('chat.timing_setup', 'Setup: {{count}} ms', { count: msg.timings.setup_ms ?? 0 })}</div>
                                                <div>{t('chat.timing_routing', 'Routing: {{count}} ms', { count: msg.timings.routing_ms ?? 0 })}</div>
                                                <div>{t('chat.timing_tools', 'Tools: {{count}} ms', { count: msg.timings.tools_ms ?? 0 })}</div>
                                                <div>{t('chat.timing_model', 'Model: {{count}} ms', { count: msg.timings.model_ms ?? 0 })}</div>
                                                <div>{t('chat.timing_misc', 'Other: {{count}} ms', { count: msg.timings.other_ms ?? 0 })}</div>
                                                <div>{t('chat.timing_usage', '{{input}} input tokens · {{output}} output tokens · {{models}} model calls · {{tools}} tool calls', {
                                                    input: msg.timings.input_tokens ?? 0,
                                                    output: msg.timings.output_tokens ?? 0,
                                                    models: msg.timings.model_calls ?? 0,
                                                    tools: msg.timings.tool_calls ?? 0,
                                                })}</div>
                                            </>
                                        )}
                                        {msg.explanation && (
                                            <div style={{ marginTop: '5px' }}>
                                                <strong>{t('chat.explanation_title', 'How this response was produced')}</strong>
                                                <div>{t('chat.explanation_plan', 'Mode: {{mode}} · Route: {{route}} · Execution: {{execution}}', {
                                                    mode: t(`chat.mode.${msg.explanation.mode}`, msg.explanation.mode),
                                                    route: t(`chat.route.${msg.explanation.route}`, msg.explanation.route),
                                                    execution: t(`chat.execution.${msg.explanation.execution}`, msg.explanation.execution),
                                                })}</div>
                                                <div>{t('chat.explanation_evidence', '{{count}} evidence item(s) · {{tools}} tool(s)', {
                                                    count: msg.explanation.evidence_count ?? 0,
                                                    tools: msg.explanation.tools_used?.length ?? 0,
                                                })}</div>
                                            </div>
                                        )}
                                        {msg.privacy && (
                                            <div style={{ marginTop: '5px' }}>
                                                <strong>{t('chat.privacy_title', 'Privacy')}</strong>
                                                <div>{t('chat.privacy_summary', '{{classification}} · {{count}} private source(s) · data minimized: {{minimized}}', {
                                                    classification: t(`chat.privacy_classification.${msg.privacy.classification}`, msg.privacy.classification),
                                                    count: msg.privacy.private_source_count ?? 0,
                                                    minimized: msg.privacy.data_minimized ? t('common.yes', 'Yes') : t('common.no', 'No'),
                                                })}</div>
                                                {msg.privacy.private_evidence_to_remote_model && (
                                                    <div>{t('chat.privacy_remote_processing', 'Required private evidence may be processed by the configured remote model.')}</div>
                                                )}
                                            </div>
                                        )}
                                        {msg.verification && (
                                            <div style={{ marginTop: '5px' }}>
                                                <strong>{t('chat.verification_title', 'Verification')}</strong>
                                                <div>{t('chat.verification_summary', '{{status}} · {{count}} evidence item(s)', {
                                                    status: t(`chat.verification_status.${msg.verification.status}`, msg.verification.status),
                                                    count: msg.verification.evidence_count ?? 0,
                                                })}</div>
                                                {msg.verification.limitations?.length > 0 && (
                                                    <div>{t('chat.verification_limitations', 'Limitations: {{limitations}}', {
                                                        limitations: msg.verification.limitations.map(value => t(`chat.verification_limitation.${value}`, value)).join(', '),
                                                    })}</div>
                                                )}
                                            </div>
                                        )}
                                        {msg.freshness && (
                                            <div style={{ marginTop: '5px' }}>
                                                <strong>{t('chat.freshness_title', 'Index freshness')}</strong>
                                                <div>{t('chat.freshness_summary', '{{status}} · age {{age}} s · {{coverage}}% cached · {{direct}} direct read(s)', {
                                                    status: t(`chat.freshness_status.${msg.freshness.status}`, msg.freshness.status),
                                                    age: msg.freshness.age_seconds ?? 0,
                                                    coverage: Math.round((msg.freshness.coverage_ratio ?? 0) * 100),
                                                    direct: msg.freshness.direct_reads ?? 0,
                                                })}</div>
                                                {msg.freshness.refresh_scheduled && <div>{t('chat.freshness_refresh', 'A non-blocking refresh was requested.')}</div>}
                                            </div>
                                        )}
                                        {msg.job && (
                                            <div style={{ marginTop: '5px' }}>
                                                <strong>{t('chat.job_title', 'Background job')}</strong>
                                                <div>{t('chat.job_summary', '{{id}} · {{status}}', { id: msg.job.job_id, status: t(`chat.job_status.${msg.job.status}`, msg.job.status) })}</div>
                                                {msg.job.retry && (
                                                    <div>
                                                        {t('chat.job_retry_budget', 'Attempt {{attempt}}/{{maxAttempts}} · model calls {{used}}/{{budget}}', {
                                                            attempt: msg.job.retry.attempt,
                                                            maxAttempts: msg.job.retry.max_attempts,
                                                            used: msg.job.retry.model_calls_used,
                                                            budget: msg.job.retry.model_call_budget,
                                                        })}
                                                        {msg.job.retry.next_retry_at && (
                                                            <> · {t('chat.job_retry_scheduled', 'next retry {{time}}', { time: new Date(msg.job.retry.next_retry_at).toLocaleTimeString() })}</>
                                                        )}
                                                        {msg.job.retry.budget_exhausted && <> · {t('chat.job_retry_exhausted', 'retry budget exhausted')}</>}
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                                                    <button type="button" onClick={() => refreshMessageJob(idx)}>{t('chat.job_refresh', 'Refresh')}</button>
                                                    {msg.job.capabilities?.result && (msg.job.result_available || msg.job.status === 'completed') && (
                                                        <button type="button" onClick={() => focusComposerWith(t('chat.job_result_prompt', 'Show the result of {{id}}', { id: msg.job.job_id }))}>{t('chat.job_result', 'Read result')}</button>
                                                    )}
                                                    {msg.job.capabilities?.resume && ['failed', 'interrupted', 'retry_wait'].includes(msg.job.status) && !msg.job.retry?.budget_exhausted && (
                                                        <button type="button" onClick={() => refreshMessageJob(idx, 'resume')}>{t('chat.job_resume', 'Resume job')}</button>
                                                    )}
                                                    {msg.job.capabilities?.cancel && ['queued', 'pending', 'running', 'retry_wait'].includes(msg.job.status) && (
                                                        <button type="button" onClick={() => refreshMessageJob(idx, 'cancel')}>{t('chat.job_cancel', 'Cancel job')}</button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        {msg.confirmation && <div>{t('chat.message_has_confirmation', 'This message includes a governed action confirmation.')}</div>}
                                        {Array.isArray(msg.attachments) && msg.attachments.length > 0 && <div>{t('chat.message_attachments_count', '{{count}} attachment(s)', { count: msg.attachments.length })}</div>}
                                    </div>
                                )}
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', padding: '0 4px' }}>
                                    {msg.role === 'user'
                                        ? t('chat.you', "You")
                                        : `${agentName}${msg.llm?.model ? ` - ${msg.llm.model}` : ''}`}
                                    {msg.role !== 'user' && processingSeconds(msg.processingMs) !== null
                                        ? ` · ${t('chat.processing_seconds', '{{count}} s', { count: processingSeconds(msg.processingMs) })}`
                                        : ''}
                                </span>
                            </div>
                        ))}
                        {!showSessionsView && isLoading && (
                            <div style={{ alignSelf: 'flex-start', display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                <Sparkles size={14} className="spin-slow" /> {t('chat.processing_with_seconds', 'Processing... {{count}} s', { count: processingElapsedSeconds })}
                                <button
                                    type="button"
                                    onClick={() => requestAbortRef.current?.abort()}
                                    style={{ border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.76rem' }}
                                >
                                    {t('chat.cancel_response', 'Cancel')}
                                </button>
                            </div>
                        )}
                        {!showSessionsView && <div ref={messagesEndRef} />}
                    </div>

                    {/* Input Area */}
                    <div style={{ padding: '10px 10px 8px 10px', borderTop: '1px solid var(--settings-border, #e5e7eb)', background: 'var(--bg-primary)' }}>
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
                                <button type="button" onClick={handlePickAttachment} disabled={isUploadingAttachment} aria-label={t('chat.attach_files', "Attach files")} title={t('chat.attach_files', "Attach files")} style={{ background: 'none', border: 'none', cursor: isUploadingAttachment ? 'default' : 'pointer', color: 'var(--text-secondary)', padding: '8px', opacity: isUploadingAttachment ? 0.6 : 1 }}>
                                    <Paperclip size={18} />
                                </button>
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
                                    placeholder={t('chat.input_placeholder', "Write a message... (use @ to mention)")}
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

                        <div style={{ marginTop: '6px', padding: '0 2px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <button onClick={createNewSession} disabled={isLoading} title={t('chat.new_session', "New session")} aria-label={t('chat.new_session', "New session")} style={{ width: '26px', height: '26px', borderRadius: '13px', border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', cursor: isLoading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Plus size={12} />
                                </button>
                                <button onClick={() => setShowSessionsView((v) => !v)} title={t('chat.sessions', 'Sessions')} aria-label={t('chat.sessions', 'Sessions')} style={{ width: '26px', height: '26px', borderRadius: '13px', border: '1px solid var(--settings-border, #e5e7eb)', background: showSessionsView ? 'var(--settings-sidebar-bg, #f3f4f6)' : 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Archive size={12} />
                                </button>
                            </div>
                        </div>
                    </div>
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
