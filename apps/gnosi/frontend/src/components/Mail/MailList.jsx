import React, { useState, useEffect, useMemo } from 'react';
import { Search, Star, Paperclip, MoreVertical, RefreshCw, CheckCircle2, Circle } from 'lucide-react';
import { format, isToday, isYesterday, isThisWeek, parseISO } from 'date-fns';
import { ca } from 'date-fns/locale';

export default function MailList({ account, onSelectMail, folder, category }) {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMsgId, setSelectedMsgId] = useState(null);

    const fetchMessages = () => {
        if (!account?.email) return;
        setLoading(true);
        let url = `/api/mail/messages?email=${encodeURIComponent(account.email)}&limit=100`;
        if (folder && folder !== 'all') url += `&folder=${encodeURIComponent(folder)}`;
        if (category) url += `&category=${encodeURIComponent(category)}`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                setMessages(data || []);
                setLoading(false);
            })
            .catch(err => {
                console.error("Error fetching messages:", err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchMessages();
    }, [account, folder, category]);

    // Group messages by date categories
    const groupedMessages = useMemo(() => {
        const groups = {};
        messages.forEach(msg => {
            if (!msg) return;
            const timestamp = msg.timestamp || (Date.now() / 1000);
            const date = parseISO(msg.date_obj || new Date(timestamp * 1000).toISOString());
            let groupTitle = format(date, 'MMMM yyyy', { locale: ca });

            if (isToday(date)) groupTitle = 'Avui';
            else if (isYesterday(date)) groupTitle = 'Ahir';
            else if (isThisWeek(date)) groupTitle = 'Aquesta setmana';

            if (!groups[groupTitle]) groups[groupTitle] = [];
            groups[groupTitle].push(msg);
        });
        return groups;
    }, [messages]);

    const handleSelect = (msg) => {
        setSelectedMsgId(msg.id);
        onSelectMail(msg);
    };

    return (
        <div className="w-[450px] flex flex-col h-full border-r border-slate-200 bg-white">
            <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">Safata d'entrada</h2>
                    <button
                        onClick={fetchMessages}
                        className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-indigo-600 transition-all active:scale-95"
                        disabled={loading}
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={16} />
                    <input
                        type="text"
                        placeholder="Cerca al correu..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all placeholder:text-slate-400"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2">
                {loading && messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 space-y-4">
                        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-sm font-medium text-slate-500">Sincronitzant amb Gnosi...</p>
                    </div>
                ) : Object.keys(groupedMessages).length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="bg-slate-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <Search className="text-slate-300" size={32} />
                        </div>
                        <p className="text-slate-500 font-medium">No hi ha missatges aquí</p>
                    </div>
                ) : (
                    Object.entries(groupedMessages).map(([groupTitle, msgs]) => (
                        <div key={groupTitle} className="mb-6">
                            <h3 className="px-4 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                                {groupTitle}
                            </h3>
                            <div className="space-y-0.5">
                                {msgs.map((msg) => (
                                    <div
                                        key={msg.id}
                                        onClick={() => handleSelect(msg)}
                                        className={`group relative mx-2 p-4 rounded-xl cursor-pointer transition-all duration-200 border border-transparent ${selectedMsgId === msg.id
                                            ? 'bg-indigo-50/70 border-indigo-100 shadow-sm'
                                            : 'hover:bg-slate-50'
                                            }`}
                                    >
                                        <div className="flex justify-between items-start gap-3 mb-1.5">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                {!msg.is_read && (
                                                    <div className="w-2 h-2 rounded-full bg-indigo-600 flex-shrink-0" />
                                                )}
                                                <span className={`text-[13px] truncate flex-1 ${!msg.is_read ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}`}>
                                                    {(msg.sender || 'Desconegut').split('<')[0].trim()}
                                                </span>
                                                {msg.is_starred && (
                                                    <Star size={12} className="text-amber-500 fill-amber-500 flex-shrink-0" />
                                                )}
                                            </div>
                                            <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
                                                {format(new Date(msg.timestamp * 1000), 'HH:mm')}
                                            </span>
                                        </div>

                                        <h4 className={`text-[13px] mb-1 truncate leading-snug ${!msg.is_read ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>
                                            {msg.subject || '(Sense assumpte)'}
                                        </h4>

                                        <p className="text-[12px] text-slate-500 line-clamp-2 leading-relaxed opacity-80 group-hover:opacity-100 transition-opacity">
                                            {msg.snippet}
                                        </p>

                                        {msg.labels && (
                                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                                                {msg.labels.split(',').filter(l => !l.startsWith('CATEGORY_') && !['INBOX', 'UNREAD', 'IMPORTANT', 'STARRED'].includes(l)).slice(0, 2).map(label => (
                                                    <span key={label} className="px-2 py-0.5 bg-slate-100 text-[10px] font-bold text-slate-500 rounded-md">
                                                        {label}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                                            <div className="flex items-center gap-1 bg-white/80 backdrop-blur shadow-sm border border-slate-100 rounded-lg p-1">
                                                <button className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400 transition-colors">
                                                    <Star size={14} />
                                                </button>
                                                <button className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400 transition-colors">
                                                    <CheckCircle2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
