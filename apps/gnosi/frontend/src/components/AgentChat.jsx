import React, { useState, useRef, useEffect } from 'react';

const AgentChat = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState('');

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
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

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

            // Afegim missatge buit per anar omplint
            setMessages(prev => [...prev, aiMsg]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line) continue;
                    try {
                        const data = JSON.parse(line);

                        // Handle structured events
                        setMessages(prev => {
                            const newMsgs = [...prev];
                            const lastMsg = newMsgs[newMsgs.length - 1];

                            if (data.type === 'thought') {
                                // If last message is assistant, append content
                                if (lastMsg.role === 'assistant') {
                                    // Avoid duplicating content if it was already sent via "message" fallback
                                    // But simpler approach: just update content
                                    if (data.content && !lastMsg.content.includes(data.content)) {
                                        // Append only unique parts or replace if empty?
                                        // LangGraph sends full updates usually. Let's assume append for streams or set for updates.
                                        // Given our backend logic sends "msg.content", it's the full chunk.
                                        // But wait, "messages" in state update usually contains the FULL message object if it's the update.
                                        // Let's assume data.content is the chunk or full text.
                                        // For simplicity in this iteration:
                                        lastMsg.content = data.content;
                                    }
                                }
                            } else if (data.type === 'tool_start') {
                                // Add a "Tool Status" line to the content
                                lastMsg.content += `\n🛠️ Executant: ${data.tool}...\n`;
                            } else if (data.type === 'tool_end') {
                                // Update status
                                lastMsg.content += `✅ Resultat (${data.tool}): ${data.output.substring(0, 50)}...\n`;
                            } else if (data.type === 'message' && data.role === 'ai') {
                                // Generic fallback
                                lastMsg.content = data.content;
                            }

                            return newMsgs;
                        });

                    } catch (e) {
                        console.error("Error parsing JSON chunk", e);
                    }
                }
            }

        } catch (error) {
            setMessages(prev => [...prev, { role: 'system', content: `Error: ${error.message}` }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999 }}>
            {/* Botó toggle */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    style={{
                        width: '60px', height: '60px', borderRadius: '50%',
                        backgroundColor: '#007bff', color: 'white', border: 'none',
                        fontSize: '24px', cursor: 'pointer', boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
                    }}
                >
                    💬
                </button>
            )}

            {/* Finestra de Xat */}
            {isOpen && (
                <div style={{
                    width: '350px', height: '500px', backgroundColor: 'white',
                    borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    fontFamily: 'system-ui, -apple-system, sans-serif'
                }}>
                    {/* Header */}
                    <div style={{
                        padding: '16px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #e9ecef',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                        <h3 style={{ margin: 0, fontSize: '16px' }}>Digital Brain Copilot</h3>
                        <button
                            onClick={() => setIsOpen(false)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}
                        >✖</button>
                    </div>

                    {/* Missatges */}
                    <div style={{ flex: 1, padding: '16px', overflowY: 'auto', backgroundColor: '#fff' }}>
                        {messages.map((msg, idx) => (
                            <div key={idx} style={{
                                marginBottom: '12px',
                                textAlign: msg.role === 'user' ? 'right' : 'left'
                            }}>
                                <div style={{
                                    display: 'inline-block', padding: '8px 12px', borderRadius: '12px',
                                    backgroundColor: msg.role === 'user' ? '#007bff' : '#f1f3f5',
                                    color: msg.role === 'user' ? 'white' : 'black',
                                    maxWidth: '80%', wordWrap: 'break-word'
                                }}>
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {isLoading && <div style={{ color: '#aaa', fontSize: '12px' }}>Thinking...</div>}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <form onSubmit={handleSubmit} style={{
                        padding: '12px', borderTop: '1px solid #e9ecef', display: 'flex'
                    }}>
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder="Pregunta al teu cervell..."
                            style={{
                                flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ced4da',
                                marginRight: '8px'
                            }}
                        />
                        <button type="submit" disabled={isLoading} style={{
                            padding: '8px 16px', backgroundColor: '#007bff', color: 'white',
                            border: 'none', borderRadius: '4px', cursor: 'pointer'
                        }}>Enviar</button>
                    </form>
                </div>
            )}
        </div>
    );
};

export default AgentChat;
