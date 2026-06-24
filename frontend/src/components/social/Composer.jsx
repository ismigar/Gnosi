import React, { useState, useEffect } from 'react';
import { Send, Calendar as CalendarIcon, X, AlertTriangle, Loader2 } from 'lucide-react';
import Scheduler from './Scheduler';

const NETWORK_STYLES = {
    mastodon: { color: 'bg-purple-600', border: 'border-purple-500/50' },
    linkedin:  { color: 'bg-blue-700',  border: 'border-blue-600/50' },
    facebook:  { color: 'bg-blue-600',  border: 'border-blue-500/50' },
    telegram:  { color: 'bg-sky-400',   border: 'border-sky-400/50' },
    bluesky:   { color: 'bg-blue-500',  border: 'border-blue-400/50' },
};

const Composer = () => {
    const [content, setContent] = useState('');
    const [networks, setNetworks] = useState([]);
    const [selectedNetworks, setSelectedNetworks] = useState([]);
    const [isPosting, setIsPosting] = useState(false);
    const [showScheduler, setShowScheduler] = useState(false);
    const [scheduledTime, setScheduledTime] = useState(null);

    useEffect(() => {
        fetch('/api/social/networks')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return;
                const enabled = data.filter(n => n.enabled);
                setNetworks(enabled.map(n => ({
                    ...n,
                    ...(NETWORK_STYLES[n.id] || { color: 'bg-zinc-600', border: 'border-zinc-500/50' }),
                })));
                setSelectedNetworks(enabled.map(n => n.id));
            })
            .catch(() => {});
    }, []);

    const toggleNetwork = (id) => {
        setSelectedNetworks(prev =>
            prev.includes(id) ? prev.filter(n => n !== id) : [...prev, id]
        );
    };

    const handlePost = async (immediate = true) => {
        setIsPosting(true);
        try {
            const endpoint = immediate ? '/api/social/post' : '/api/social/schedule';
            const payload = {
                content,
                networks: selectedNetworks,
                ...(scheduledTime && !immediate && { scheduled_time: scheduledTime.toISOString() })
            };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Failed to post');
            }

            const message = immediate
                ? 'Post published successfully!'
                : `Post scheduled for ${scheduledTime.toLocaleString()}`;

            alert(message);
            setContent('');
            setScheduledTime(null);
            setShowScheduler(false);
        } catch (error) {
            console.error(error);
            alert(`Error: ${error.message}`);
        } finally {
            setIsPosting(false);
        }
    };

    const handleSchedule = (dateTime) => {
        setScheduledTime(dateTime);
        setShowScheduler(false);
    };

    return (
        <div className="glass-panel p-6 rounded-2xl shadow-xl border border-[var(--border-primary)] relative z-10 backdrop-blur-xl">
            {/* Header / Network Selector */}
            <div className="mb-4 flex flex-wrap gap-2">
                {networks.map(net => {
                    const isSelected = selectedNetworks.includes(net.id);
                    return (
                        <button
                            key={net.id}
                            onClick={() => toggleNetwork(net.id)}
                            className={`
                                px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 flex items-center gap-1.5 border
                                ${isSelected
                                    ? `${net.color} text-white border-transparent shadow-lg shadow-black/20 transform -translate-y-0.5`
                                    : `bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]`
                                }
                            `}
                        >
                            <span className="text-sm">{net.icon}</span>
                            <span>{net.name}</span>
                        </button>
                    )
                })}
            </div>

            {/* Text Area */}
            <div className="relative">
                <textarea
                    className="w-full p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:ring-2 focus:ring-[var(--gnosi-blue)]/30 focus:border-[var(--gnosi-blue)]/40 focus:outline-none resize-none transition-all scrollbar-thin"
                    rows="5"
                    placeholder="Què està passant?"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                />

                <div className="absolute bottom-3 right-3 flex items-center gap-3 text-xs bg-[var(--bg-secondary)]/80 px-2 py-1 rounded-full backdrop-blur-sm">
                    <span className={`${content.length > 280 ? 'text-[var(--status-error)]' : 'text-[var(--text-secondary)]'}`}>
                        {content.length} caràcters
                    </span>
                    {content.length > 280 && (
                        <AlertTriangle size={12} className="text-yellow-500" />
                    )}
                </div>
            </div>

            {/* Scheduled Time Badge */}
            {scheduledTime && (
                <div className="mt-3 flex items-center justify-between bg-blue-500/10 border border-blue-500/20 px-3 py-2 rounded-lg text-sm text-blue-300">
                    <div className="flex items-center gap-2">
                        <CalendarIcon size={16} />
                        <span>Programat per: <strong>{scheduledTime.toLocaleString()}</strong></span>
                    </div>
                    <button
                        onClick={() => setScheduledTime(null)}
                        className="text-zinc-400 hover:text-white p-1 hover:bg-white/10 rounded"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Scheduler Component Overlay */}
            {showScheduler && (
                <div className="absolute top-0 right-0 z-50 mt-16 mr-4">
                    <div className="glass-card p-4 rounded-xl shadow-2xl border border-[var(--border-primary)]">
                        <Scheduler
                            onSchedule={handleSchedule}
                            onCancel={() => setShowScheduler(false)}
                        />
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="flex justify-between items-center mt-4">
                <button
                    onClick={() => setShowScheduler(!showScheduler)}
                    disabled={!content || selectedNetworks.length === 0}
                    className={`
                        px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 text-sm
                        ${showScheduler ? 'bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] border border-[var(--gnosi-blue)]/20' : 'border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'}
                        disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                >
                    <CalendarIcon size={18} />
                    <span>Programar</span>
                </button>

                <button
                    onClick={() => scheduledTime ? handlePost(false) : handlePost(true)}
                    disabled={!content || selectedNetworks.length === 0 || isPosting}
                    className="bg-[var(--gnosi-blue)] hover:opacity-90 disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] text-white px-6 py-2 rounded-lg font-medium transition-all shadow-lg flex items-center gap-2 transform hover:scale-105 active:scale-95 duration-200"
                >
                    {isPosting ? (
                        <Loader2 size={18} className="animate-spin" />
                    ) : (
                        scheduledTime ? <CalendarIcon size={18} /> : <Send size={18} />
                    )}
                    <span>
                        {isPosting ? 'Publicant...' : scheduledTime ? 'Confirmar Programa' : 'Publicar Ara'}
                    </span>
                </button>
            </div>
        </div>
    );
};

export default Composer;
