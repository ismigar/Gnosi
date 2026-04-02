import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as LucideIcons from 'lucide-react';
import { Send, X, Trash2, Mic, Paperclip, Minimize2, Maximize2, Bot, User, Sparkles } from 'lucide-react';

const AgentChat = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState('');
    const [agentConfig, setAgentConfig] = useState(null);
    const [isMinimized, setIsMinimized] = useState(false);

    // Ref per fer scroll al final
    const messagesEndRef = useRef(null);

    // Init session ID
    useEffect(() => {
        let sid = localStorage.getItem('agent_session_id');
        if (!sid) {
            sid = crypto.randomUUID();
            localStorage.setItem('agent_session_id', sid);
        }
        setSessionId(sid);
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                const data = await res.json();
                const ai = data.ai || {};
                const activeId = ai.active_agent_id;
                const agent = (ai.agents || []).find(a => a.id === activeId) || (ai.agents || [])[0];
                if (agent) setAgentConfig(agent);
            }
        } catch (e) {
            console.error("Error loading agent config", e);
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen, isMinimized]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!inputValue.trim() || isLoading) return;

        const userMsg = { role: 'user', content: inputValue };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setIsLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMsg.content,
                    session_id: sessionId
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

    if (!isOpen) {
        return (
            <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999 }}>
                <button
                    onClick={() => setIsOpen(true)}
                    className="premium-chat-trigger"
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
                        <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)' }}>{agentName}</h3>
                        {!isMinimized && <div style={{ fontSize: '0.7rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }}></span> En línia
                        </div>}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                        {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                        <X size={18} />
                    </button>
                </div>
            </div>

            {!isMinimized && (
                <>
                    {/* Missatges */}
                    <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {messages.length === 0 && (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>
                                <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🧬</div>
                                <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Com t'ajudo avui?</h4>
                                <p style={{ fontSize: '0.85rem', margin: 0 }}>Puc analitzar el teu Vault, gestionar el calendari o escriure codi per a tu.</p>
                            </div>
                        )}
                        {messages.map((msg, idx) => (
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
                                </div>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', padding: '0 4px' }}>
                                    {msg.role === 'user' ? 'Tu' : agentName}
                                </span>
                            </div>
                        ))}
                        {isLoading && (
                            <div style={{ alignSelf: 'flex-start', display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                <Sparkles size={14} className="spin-slow" /> Processant...
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div style={{ padding: '16px', borderTop: '1px solid var(--settings-border, #e5e7eb)', background: 'var(--bg-primary)' }}>
                        <form onSubmit={handleSubmit} style={{
                            display: 'flex', gap: '8px', alignItems: 'flex-end',
                            background: 'var(--settings-input-bg, #f9fafb)', padding: '8px',
                            borderRadius: '16px', border: '1px solid var(--settings-border, #e5e7eb)'
                        }}>
                            <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '8px' }}>
                                <Paperclip size={18} />
                            </button>
                            <textarea
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSubmit(e);
                                    }
                                }}
                                placeholder="Escriu un missatge..."
                                style={{
                                    flex: 1, padding: '8px', border: 'none', outline: 'none',
                                    background: 'transparent', color: 'var(--text-primary)',
                                    fontSize: '0.9rem', resize: 'none', maxHeight: '120px',
                                    minHeight: '24px'
                                }}
                                rows={1}
                            />
                            <button 
                                type="submit" 
                                disabled={isLoading || !inputValue.trim()} 
                                style={{ 
                                    width: '36px', height: '36px', borderRadius: '12px',
                                    backgroundColor: inputValue.trim() ? 'var(--gnosi-blue, #2563eb)' : '#e5e7eb',
                                    color: 'white', border: 'none', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <Send size={18} />
                            </button>
                        </form>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 4px 0 4px' }}>
                            <button 
                                onClick={() => {
                                    const sid = crypto.randomUUID();
                                    localStorage.setItem('agent_session_id', sid);
                                    setSessionId(sid);
                                    setMessages([]);
                                }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                <Trash2 size={12} /> Netejar xat
                            </button>
                            <span style={{ fontSize: '0.7rem', color: '#ccc' }}>Shift + Enter per línia nova</span>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AgentChat;
