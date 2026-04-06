import React, { useState, useRef, useEffect } from 'react';
import * as LucideIcons from 'lucide-react';
import { Send, X, Paperclip, Minimize2, Maximize2, Bot, Sparkles, Plus, AtSign, Archive } from 'lucide-react';

const CHAT_SESSIONS_KEY = 'agent_chat_sessions_v1';
const CHAT_ACTIVE_SESSION_KEY = 'agent_chat_active_session_id';
const MAX_CHAT_ATTACHMENT_SIZE = 15 * 1024 * 1024;

const createChatSession = (title = 'Nova conversa') => ({
    id: crypto.randomUUID(),
    title,
    archived: false,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
});

const deriveSessionTitle = (messages, fallback = 'Nova conversa') => {
    const firstUser = (messages || []).find((m) => m.role === 'user' && String(m.content || '').trim());
    if (!firstUser) return fallback;
    const clean = String(firstUser.content).replace(/@\[[^\]]+\]\([^\)]+\)/g, '').trim();
    if (!clean) return fallback;
    return clean.length > 42 ? `${clean.slice(0, 42)}...` : clean;
};

const parseMentions = (text) => {
    const mentions = [];
    const regex = /@\[([^\]]+)\]\((page|table|database):([^\)]+)\)/g;
    let match = regex.exec(text || '');
    while (match) {
        mentions.push({ label: match[1], type: match[2], id: match[3] });
        match = regex.exec(text || '');
    }
    return mentions;
};

const AgentChat = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState('');
    const [agentConfig, setAgentConfig] = useState(null);
    const [agentList, setAgentList] = useState([]);
    const [selectedAgentId, setSelectedAgentId] = useState('gnosy');
    const [isMinimized, setIsMinimized] = useState(false);
    const [llmOptions, setLlmOptions] = useState([]);
    const [selectedLlm, setSelectedLlm] = useState('auto');
    const [lastUsedLlm, setLastUsedLlm] = useState(null);
    const [llmSelectionHydrated, setLlmSelectionHydrated] = useState(false);
    const [chatSessions, setChatSessions] = useState([]);
    const [sessionsHydrated, setSessionsHydrated] = useState(false);
    const [showSessionsView, setShowSessionsView] = useState(false);
    const [mentionCatalog, setMentionCatalog] = useState([]);
    const [mentionResults, setMentionResults] = useState([]);
    const [showMentionMenu, setShowMentionMenu] = useState(false);
    const [mentionAnchorIndex, setMentionAnchorIndex] = useState(-1);
    const [attachments, setAttachments] = useState([]);
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

    // Ref per fer scroll al final
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);

    // Init session ID
    useEffect(() => {
        let sid = localStorage.getItem('agent_session_id');
        const savedLlm = localStorage.getItem('agent_selected_llm');
        const savedAgentId = localStorage.getItem('agent_selected_id');
        const savedSessionsRaw = localStorage.getItem(CHAT_SESSIONS_KEY);
        const savedActiveSession = localStorage.getItem(CHAT_ACTIVE_SESSION_KEY);

        let parsedSessions = [];
        try {
            parsedSessions = savedSessionsRaw ? JSON.parse(savedSessionsRaw) : [];
        } catch (e) {
            parsedSessions = [];
        }

        if (!Array.isArray(parsedSessions) || !parsedSessions.length) {
            parsedSessions = [createChatSession('Nova conversa')];
        }

        const activeFromStorage = savedActiveSession || sid || parsedSessions[0].id;
        let activeSession = parsedSessions.find((s) => s.id === activeFromStorage);
        if (!activeSession) {
            activeSession = parsedSessions.find((s) => !s.archived) || parsedSessions[0];
        }

        if (!sid) {
            sid = activeSession.id;
        }
        if (savedLlm) {
            setSelectedLlm(savedLlm);
        }
        if (savedAgentId) {
            setSelectedAgentId(savedAgentId);
        }

        setChatSessions(parsedSessions);
        setMessages(activeSession.messages || []);
        setSessionId(activeSession.id);
        if (activeSession.id) {
            localStorage.setItem(CHAT_ACTIVE_SESSION_KEY, activeSession.id);
            localStorage.setItem('agent_session_id', activeSession.id);
        }

        setSessionsHydrated(true);
        setLlmSelectionHydrated(true);
        loadConfig();
        loadLlmOptions();
        loadMentionCatalog();
    }, []);

    useEffect(() => {
        if (!llmSelectionHydrated) return;
        localStorage.setItem('agent_selected_llm', selectedLlm);
    }, [selectedLlm, llmSelectionHydrated]);

    useEffect(() => {
        if (!sessionsHydrated) return;
        localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(chatSessions));
    }, [chatSessions, sessionsHydrated]);

    useEffect(() => {
        if (!sessionsHydrated || !sessionId) return;
        localStorage.setItem(CHAT_ACTIVE_SESSION_KEY, sessionId);
        localStorage.setItem('agent_session_id', sessionId);
    }, [sessionId, sessionsHydrated]);

    useEffect(() => {
        localStorage.setItem('agent_selected_id', selectedAgentId);
    }, [selectedAgentId]);

    useEffect(() => {
        if (!sessionsHydrated || !sessionId) return;
        setChatSessions((prev) => prev.map((session) => {
            if (session.id !== sessionId) return session;
            return {
                ...session,
                messages,
                updatedAt: Date.now(),
                title: deriveSessionTitle(messages, session.title || 'Nova conversa'),
            };
        }));
    }, [messages, sessionId, sessionsHydrated]);

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

    const getOptionProfile = (providerId, modelId) => {
        const p = (providerId || '').toLowerCase();
        const m = (modelId || '').toLowerCase();

        if (m.includes('8b') || m.includes('mini') || m.includes('haiku') || m.includes('flash')) {
            return 'rapido';
        }
        if (m.includes('70b') || m.includes('sonnet') || m.includes('4o')) {
            return 'equilibrado';
        }
        if (m.includes('opus') || m.includes('o1') || m.includes('o3')) {
            return 'alta-calidad';
        }
        if (p === 'ollama') {
            return 'local';
        }
        return 'equilibrado';
    };

    const loadLlmOptions = async () => {
        try {
            const res = await fetch('/api/ai/catalog');
            if (!res.ok) return;

            const payload = await res.json();
            const providers = Array.isArray(payload?.catalog?.providers) ? payload.catalog.providers : [];
            const localProviders = new Set(['ollama', 'llama-cpp', 'lmstudio', 'local', 'generic']);

            const options = [];
            providers.forEach((provider) => {
                const providerId = provider?.id;
                if (!providerId) return;
                const hasKey = Boolean(provider?.has_api_key);
                const isLocal = localProviders.has(providerId);
                const models = Array.isArray(provider?.models) ? provider.models : [];

                if (!hasKey && !isLocal) return;

                if (models.length > 0) {
                    models.forEach((modelId) => {
                        const profile = getOptionProfile(providerId, modelId);
                        options.push({
                            value: `manual:${providerId}:${modelId}`,
                            label: `${providerId} · ${modelId}`,
                            profile,
                        });
                    });
                } else if (provider?.model_name) {
                    const profile = getOptionProfile(providerId, provider.model_name);
                    options.push({
                        value: `manual:${providerId}:${provider.model_name}`,
                        label: `${providerId} · ${provider.model_name}`,
                        profile,
                    });
                }
            });

            setLlmOptions(options);
        } catch (e) {
            console.error('Error loading LLM options', e);
        }
    };

    const loadConfig = async () => {
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                const data = await res.json();
                const ai = data.ai || {};
                const activeId = ai.active_agent_id;
                const agents = ai.agents || [];
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
    };

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

    const loadMentionCatalog = async () => {
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
                    subtitle: 'Pagina',
                    search: `page ${label} ${p.id}`.toLowerCase(),
                };
            });

            const tableItems = (Array.isArray(tables) ? tables : []).map((t) => {
                const label = t.name || t.title || t.id;
                return {
                    id: String(t.id),
                    type: 'table',
                    label: String(label),
                    subtitle: 'Tabla',
                    search: `table ${label} ${t.id}`.toLowerCase(),
                };
            });

            const dbItems = (Array.isArray(dbs) ? dbs : []).map((d) => {
                const label = d.name || d.title || d.id;
                return {
                    id: String(d.id),
                    type: 'database',
                    label: String(label),
                    subtitle: 'BD',
                    search: `database bd ${label} ${d.id}`.toLowerCase(),
                };
            });

            setMentionCatalog([...pageItems, ...tableItems, ...dbItems]);
        } catch (e) {
            console.error('Error loading mention catalog', e);
        }
    };

    const selectSession = (nextId) => {
        const target = chatSessions.find((s) => s.id === nextId);
        if (!target) return;
        setChatSessions((prev) => prev.map((s) => s.id === nextId ? { ...s, archived: false, updatedAt: Date.now() } : s));
        setSessionId(target.id);
        setMessages(target.messages || []);
        setShowSessionsView(false);
    };

    const archiveCurrentSession = () => {
        if (!sessionId) return;
        setChatSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, archived: true, updatedAt: Date.now() } : s));
    };

    const createNewSession = () => {
        const next = createChatSession('Nova conversa');
        setChatSessions((prev) => [
            next,
            ...prev.map((s) => s.id === sessionId ? { ...s, archived: true, updatedAt: Date.now() } : s),
        ]);
        setSessionId(next.id);
        setMessages([]);
        setInputValue('');
        setLastUsedLlm(null);
        setShowSessionsView(false);
    };

    const deleteSessionById = (targetId) => {
        if (!targetId) return;

        const remaining = chatSessions.filter((s) => s.id !== targetId);
        if (!remaining.length) {
            const fresh = createChatSession('Nova conversa');
            setChatSessions([fresh]);
            setSessionId(fresh.id);
            setMessages([]);
            setInputValue('');
            return;
        }

        setChatSessions(remaining);

        if (targetId === sessionId) {
            const nextSession = remaining[0];
            setSessionId(nextSession.id);
            setMessages(nextSession.messages || []);
        }
    };

    const applyMention = (item) => {
        const current = inputValue || '';
        const caret = inputRef.current?.selectionStart ?? current.length;
        if (mentionAnchorIndex < 0 || mentionAnchorIndex > caret) return;

        const token = `@[${item.label}](${item.type}:${item.id}) `;
        const before = current.slice(0, mentionAnchorIndex);
        const after = current.slice(caret);
        const nextValue = `${before}${token}${after}`;
        const nextCaret = before.length + token.length;

        setInputValue(nextValue);
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

    const uploadAttachmentFile = async (file) => {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/vault/upload-cover', {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            const detail = await res.text();
            throw new Error(detail || 'No se pudo subir el archivo');
        }

        const data = await res.json();
        return {
            id: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            type: file.type,
            path: data.path || null,
            url: data.url || null,
        };
    };

    const handleAttachmentInputChange = async (e) => {
        const picked = Array.from(e.target.files || []);
        e.target.value = '';
        if (!picked.length) return;

        const validFiles = picked.filter((file) => file.size <= MAX_CHAT_ATTACHMENT_SIZE);
        const skipped = picked.length - validFiles.length;
        if (skipped > 0) {
            setMessages((prev) => [
                ...prev,
                { role: 'system', content: `Aviso: ${skipped} archivo(s) superan 15MB y no se adjuntaron.` },
            ]);
        }
        if (!validFiles.length) return;

        setIsUploadingAttachment(true);
        try {
            const uploaded = [];
            for (const file of validFiles) {
                const saved = await uploadAttachmentFile(file);
                uploaded.push(saved);
            }
            setAttachments((prev) => [...prev, ...uploaded]);
        } catch (error) {
            setMessages((prev) => [...prev, { role: 'system', content: `Error subiendo adjunto: ${error.message}` }]);
        } finally {
            setIsUploadingAttachment(false);
        }
    };

    const removeAttachment = (attachmentId) => {
        setAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen, isMinimized]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if ((!inputValue.trim() && attachments.length === 0) || isLoading) return;

        const mentions = parseMentions(inputValue);
        const attachmentsPayload = attachments.map((item) => ({
            name: item.name,
            size: item.size,
            type: item.type,
            path: item.path,
            url: item.url,
        }));

        const hasAttachments = attachmentsPayload.length > 0;
        const attachmentSummary = hasAttachments
            ? `\n\nArchivos adjuntos:\n${attachmentsPayload.map((item) => `- ${item.name}${item.url ? ` (${item.url})` : ''}`).join('\n')}`
            : '';

        const messageToSend = `${inputValue}${attachmentSummary}`;

        const visibleContent = inputValue.trim() ? inputValue : '(Adjuntos)';

        const userMsg = {
            role: 'user',
            content: visibleContent,
            mentions,
            attachments: attachmentsPayload,
        };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setAttachments([]);
        setShowMentionMenu(false);
        setIsLoading(true);

        try {
            let llm_mode = 'auto';
            let llm_provider = null;
            let llm_model = null;

            if (selectedLlm !== 'auto') {
                const [mode, provider, model] = selectedLlm.split(':');
                if (mode === 'manual' && provider && model) {
                    llm_mode = 'manual';
                    llm_provider = provider;
                    llm_model = model;
                }
            }

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: messageToSend,
                    agent_id: selectedAgentId,
                    session_id: sessionId,
                    llm_mode,
                    llm_provider,
                    llm_model,
                    mentions,
                    attachments: attachmentsPayload,
                })
            });

            if (!response.ok) throw new Error(response.statusText);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let aiMsg = { role: 'assistant', content: '' };

            setMessages(prev => [...prev, aiMsg]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        setMessages(prev => {
                            const newMsgs = [...prev];
                            const lastIdx = newMsgs.length - 1;
                            const lastMsg = { ...newMsgs[lastIdx] };

                            if (data.type === 'tool_start') {
                                lastMsg.content = `🛠️ *Cridant eina: ${data.tool}...*`;
                            } else if (data.type === 'tool_end') {
                                lastMsg.content = `✅ *Eina ${data.tool} finalitzada.*`;
                            } else if (data.type === 'message' || data.type === 'thought') {
                                if (data.content) lastMsg.content = data.content;
                            } else if (data.type === 'llm_selected') {
                                const llmInfo = {
                                    mode: data.mode || 'auto',
                                    provider: data.provider,
                                    model: data.model,
                                };
                                setLastUsedLlm(llmInfo);
                                lastMsg.llm = llmInfo;
                            } else if (data.type === 'error') {
                                lastMsg.content = `❌ Error: ${data.content}`;
                            }

                            newMsgs[lastIdx] = lastMsg;
                            return newMsgs;
                        });
                    } catch (e) {
                        console.error("Error parsing JSON line:", line, e);
                    }
                }
            }
        } catch (error) {
            setMessages(prev => [...prev, { role: 'system', content: `Error: ${error.message}` }]);
        } finally {
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
            const IconComp = LucideIcons[name];
            // Simple color mapping or just inherit
            return IconComp ? <IconComp size={size} /> : <Bot size={size} />;
        }
        return <span style={{ fontSize: `${size}px` }}>{iconStr}</span>;
    };

    const agentName = agentConfig?.name || 'Gnosi Copilot';
    const agentIcon = agentConfig?.icon || '🤖';
    const sortedSessions = [...chatSessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (!isOpen) {
        return (
            <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999 }}>
                <button
                    onClick={() => setIsOpen(true)}
                    className="premium-chat-trigger"
                    aria-label="Abrir chat"
                    title="Abrir chat"
                    style={{
                        width: '56px', height: '56px', borderRadius: '18px',
                        background: 'linear-gradient(135deg, var(--gnosi-blue, #2563eb) 0%, #3b82f6 100%)',
                        color: 'white', border: 'none', cursor: 'pointer',
                        boxShadow: '0 8px 16px -4px rgba(37, 99, 235, 0.4)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                >
                    {renderIcon(agentIcon, 24)}
                </button>
            </div>
        );
    }

    return (
        <div style={{ 
            position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
            width: isMinimized ? '200px' : '400px', 
            height: isMinimized ? '50px' : '600px',
            maxHeight: 'calc(100vh - 100px)',
            backgroundColor: 'var(--bg-primary, white)',
            borderRadius: '20px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            border: '1px solid var(--settings-border, #e5e7eb)',
            transition: 'all 0.3s ease-in-out'
        }}>
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
                        {!isMinimized && <div style={{ fontSize: '0.7rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }}></span> En línia
                        </div>}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }} aria-label={isMinimized ? 'Expandir chat' : 'Minimizar chat'} title={isMinimized ? 'Expandir chat' : 'Minimizar chat'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                        {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); archiveCurrentSession(); setShowSessionsView(false); setIsOpen(false); }} aria-label="Cerrar chat" title="Cerrar chat" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                        <X size={18} />
                    </button>
                </div>
            </div>

            {!isMinimized && (
                <>
                    {/* Missatges */}
                    <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {showSessionsView && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <h4 style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-primary)' }}>Sessions</h4>
                                    <button
                                        onClick={() => setShowSessionsView(false)}
                                        style={{ border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '10px', height: '24px', padding: '0 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                                    >
                                        Tornar
                                    </button>
                                </div>

                                {sortedSessions.length === 0 && (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>No hi ha sessions.</div>
                                )}

                                {sortedSessions.map((s) => (
                                    <div key={s.id} style={{ border: '1px solid var(--settings-border, #e5e7eb)', borderRadius: '12px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || 'Sessio'}</div>
                                            <div style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>{(s.messages || []).length} missatges{s.archived ? ' · arxivada' : ''}</div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <button
                                                onClick={() => selectSession(s.id)}
                                                style={{ border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '10px', height: '24px', padding: '0 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                                            >
                                                Obrir
                                            </button>
                                            <button
                                                onClick={() => deleteSessionById(s.id)}
                                                aria-label={`Eliminar sesion ${s.title || 'sin titulo'}`}
                                                title="Eliminar sesion"
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
                                <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🧬</div>
                                <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Com t'ajudo avui?</h4>
                                <p style={{ fontSize: '0.85rem', margin: 0 }}>Puc analitzar el teu Vault, gestionar el calendari o escriure codi per a tu.</p>
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
                                    {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {msg.attachments.map((item, idx2) => (
                                                <div key={`${item.name || 'file'}-${idx2}`} style={{ fontSize: '0.76rem', opacity: 0.95 }}>
                                                    📎 {item.url ? (
                                                        <a href={item.url} target="_blank" rel="noreferrer" style={{ color: msg.role === 'user' ? 'white' : 'var(--gnosi-blue, #2563eb)', textDecoration: 'underline' }}>
                                                            {item.name || item.url}
                                                        </a>
                                                    ) : (
                                                        item.name || 'archivo'
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', padding: '0 4px' }}>
                                    {msg.role === 'user'
                                        ? 'Tu'
                                        : `${agentName}${msg.llm?.model ? ` - ${msg.llm.model}` : ''}`}
                                </span>
                            </div>
                        ))}
                        {!showSessionsView && isLoading && (
                            <div style={{ alignSelf: 'flex-start', display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                <Sparkles size={14} className="spin-slow" /> Processant...
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
                                    style={{ display: 'none' }}
                                    onChange={handleAttachmentInputChange}
                                />
                                <button type="button" onClick={handlePickAttachment} disabled={isUploadingAttachment} aria-label="Adjuntar archivos" title="Adjuntar archivos" style={{ background: 'none', border: 'none', cursor: isUploadingAttachment ? 'default' : 'pointer', color: 'var(--text-secondary)', padding: '8px', opacity: isUploadingAttachment ? 0.6 : 1 }}>
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
                                    placeholder="Escriu un missatge... (usa @ para mencionar)"
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
                                    disabled={isLoading || (!inputValue.trim() && attachments.length === 0)}
                                    aria-label="Enviar mensaje"
                                    title="Enviar mensaje"
                                    style={{
                                        width: '36px', height: '36px', borderRadius: '12px',
                                        backgroundColor: (inputValue.trim() || attachments.length > 0) ? 'var(--gnosi-blue, #2563eb)' : '#e5e7eb',
                                        color: 'white', border: 'none', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <Send size={18} />
                                </button>
                            </form>

                            {attachments.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                    {attachments.map((item) => (
                                        <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '999px', border: '1px solid var(--settings-border, #e5e7eb)', padding: '3px 8px', fontSize: '0.68rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg, #f3f4f6)' }}>
                                            <span style={{ maxWidth: '170px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                                            <button type="button" onClick={() => removeAttachment(item.id)} aria-label={`Quitar adjunto ${item.name || ''}`.trim()} title="Quitar adjunto" style={{ border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, lineHeight: 1 }}>x</button>
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

                        <div style={{ marginTop: '6px', padding: '0 2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexWrap: 'wrap' }}>
                                <div style={{
                                    height: '24px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '0 6px',
                                    borderRadius: '999px',
                                    border: '1px solid var(--settings-border, #e5e7eb)',
                                    background: 'transparent'
                                }}>
                                    <select
                                        value={selectedLlm}
                                        onChange={(e) => setSelectedLlm(e.target.value)}
                                        style={{
                                            width: 'auto',
                                            maxWidth: '170px',
                                            height: '20px',
                                            border: 'none',
                                            background: 'transparent',
                                            color: 'var(--text-primary)',
                                            fontSize: '0.7rem',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            boxShadow: 'none',
                                            WebkitAppearance: 'none',
                                            appearance: 'none'
                                        }}
                                    >
                                        <option value="auto">Auto</option>
                                        {llmOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <button onClick={createNewSession} title="Nova sessio" aria-label="Nueva sesion" style={{ width: '26px', height: '26px', borderRadius: '13px', border: '1px solid var(--settings-border, #e5e7eb)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Plus size={12} />
                                </button>
                                <button onClick={() => setShowSessionsView((v) => !v)} title="Sessions" aria-label="Abrir sesiones" style={{ width: '26px', height: '26px', borderRadius: '13px', border: '1px solid var(--settings-border, #e5e7eb)', background: showSessionsView ? 'var(--settings-sidebar-bg, #f3f4f6)' : 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Archive size={12} />
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AgentChat;
