import React, { useState, useEffect, useMemo } from 'react';
import { Search, Star, Paperclip, MoreVertical, RefreshCw, CheckCircle2, Circle, ChevronDown, Archive, Trash2 } from 'lucide-react';
import { format, isToday, isYesterday, isThisWeek, parseISO } from 'date-fns';
import { ca } from 'date-fns/locale';

export default function MailList({ account, onSelectMail, folder, category, selectedMailId }) {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [hoveredMailId, setHoveredMailId] = useState(null);
    const [contextMenu, setContextMenu] = useState(null); // { x, y, msgId }

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
        const now = new Date();
        
        messages.forEach(msg => {
            if (!msg) return;
            const timestamp = msg.timestamp || (Date.now() / 1000);
            const date = parseISO(msg.date_obj || new Date(timestamp * 1000).toISOString());
            
            let groupTitle = format(date, 'MMMM', { locale: ca }); // Default to Month Name
            
            const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

            if (isToday(date)) groupTitle = 'Avui';
            else if (isYesterday(date)) groupTitle = 'Ahir';
            else if (diffDays <= 7) groupTitle = 'Últimos 7 días';
            else if (diffDays <= 30) groupTitle = 'Últimos 30 días';
            else if (date.getFullYear() < now.getFullYear()) {
                groupTitle = format(date, 'MMMM yyyy', { locale: ca });
            }

            if (!groups[groupTitle]) groups[groupTitle] = [];
            groups[groupTitle].push(msg);
        });
        return groups;
    }, [messages]);

    const handleSelect = (msg) => {
        onSelectMail(msg);
    };

    const toggleSelect = (e, id) => {
        e.stopPropagation();
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) newSelected.delete(id);
        else newSelected.add(id);
        setSelectedIds(newSelected);
    };

    const selectAll = () => {
        if (selectedIds.size === messages.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(messages.map(m => m.id)));
    };

    const handleBatchAction = async (action) => {
        if (selectedIds.size === 0) return;
        const res = await fetch(`/api/mail/batch?email=${encodeURIComponent(account.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ids: Array.from(selectedIds) })
        });
        if (res.ok) {
            setSelectedIds(new Set());
            fetchMessages();
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 min-h-[72px]">
                {selectedIds.size > 0 ? (
                    <div className="flex items-center justify-between w-full animate-in slide-in-from-top-2 duration-200">
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-3">
                                <input 
                                    type="checkbox" 
                                    checked={selectedIds.size === messages.length}
                                    onChange={selectAll}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" 
                                />
                                <span className="text-sm font-bold text-slate-900">{selectedIds.size} seleccionats</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => handleBatchAction('archive')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 flex items-center gap-2 text-sm font-medium transition-all">
                                    <Archive size={16} />
                                    Arxivar
                                </button>
                                <button onClick={() => handleBatchAction('trash')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-red-500 flex items-center gap-2 text-sm font-medium transition-all">
                                    <Trash2 size={16} />
                                    Eliminar
                                </button>
                                <button onClick={() => handleBatchAction('read')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 flex items-center gap-2 text-sm font-medium transition-all">
                                    <CheckCircle2 size={16} />
                                    Llegit
                                </button>
                            </div>
                        </div>
                        <button onClick={() => setSelectedIds(new Set())} className="text-sm font-bold text-indigo-600 hover:text-indigo-700">Cancel·lar</button>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-4">
                            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Bandeja de entrada</h2>
                            <div className="flex items-center gap-1">
                                <button className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1.5">
                                    Categorías
                                    <ChevronDown size={12} />
                                </button>
                                <button className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1.5">
                                    Etiquetas
                                    <ChevronDown size={12} />
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button className="text-[13px] font-semibold text-slate-500 hover:text-slate-900 px-3 py-1.5 transition-colors">Restablecer</button>
                            <button className="bg-orange-100 text-orange-700 text-[13px] font-bold px-4 py-1.5 rounded-lg hover:bg-orange-200 transition-colors">Guardar vista</button>
                            <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg transition-colors">
                                <MoreVertical size={18} />
                            </button>
                        </div>
                    </>
                )}
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading && messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 space-y-4">
                        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-sm font-medium text-slate-400">Sincronitzant correu...</p>
                    </div>
                ) : Object.keys(groupedMessages).length === 0 ? (
                    <div className="p-12 text-center">
                        <p className="text-slate-400 font-medium">No hi ha missatges</p>
                    </div>
                ) : (
                    Object.entries(groupedMessages).map(([groupTitle, msgs]) => (
                        <div key={groupTitle} className="mb-6">
                            <h3 className="px-6 py-3 text-[13px] font-bold text-slate-800">
                                {groupTitle}
                            </h3>
                            <div className="border-t border-slate-50">
                                {msgs.map((msg) => (
                                    <div
                                        key={msg.id}
                                        onClick={() => handleSelect(msg)}
                                        onMouseEnter={() => setHoveredMailId(msg.id)}
                                        onMouseLeave={() => setHoveredMailId(null)}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            setContextMenu({ x: e.clientX, y: e.clientY, msgId: msg.id });
                                        }}
                                        className={`group flex items-center px-4 py-2 cursor-pointer border-b border-slate-50 hover:bg-slate-50/80 transition-colors ${selectedMailId === msg.id ? 'bg-indigo-50/50' : ''} ${selectedIds.has(msg.id) ? 'bg-indigo-50/30' : ''}`}
                                    >
                                        <div className="flex items-center gap-3 w-full relative">
                                            <div className="flex items-center gap-3 min-w-[200px] max-w-[250px]">
                                                <input 
                                                    type="checkbox" 
                                                    checked={selectedIds.has(msg.id)}
                                                    onChange={(e) => toggleSelect(e, msg.id)}
                                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" 
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                                <span className={`text-[13.5px] truncate ${!msg.is_read ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
                                                    {(msg.sender || 'Desconegut').split('<')[0].trim()}
                                                </span>
                                            </div>

                                            <div className="flex-1 flex items-center gap-3 overflow-hidden">
                                                <span className={`text-[13.5px] truncate ${!msg.is_read ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
                                                    {msg.subject || '(Sense assumpte)'}
                                                </span>
                                                <span className="text-[13.5px] text-slate-400 truncate opacity-80">
                                                    {msg.snippet}
                                                </span>

                                                {/* Hover Preview Popover */}
                                                {hoveredMailId === msg.id && (
                                                    <div className="absolute left-64 top-10 z-30 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl p-4 animate-in fade-in slide-in-from-left-2 duration-200 pointer-events-none">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className="w-6 h-6 rounded bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold uppercase">
                                                                {msg.sender?.[0]}
                                                            </div>
                                                            <span className="text-xs font-bold text-slate-900">{msg.sender?.split('<')[0]}</span>
                                                        </div>
                                                        <h4 className="text-sm font-bold text-slate-900 mb-2">{msg.subject}</h4>
                                                        <p className="text-xs text-slate-500 leading-relaxed line-clamp-4">
                                                            {msg.snippet}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                                                {msg.has_attachments && <Paperclip size={14} className="text-slate-400" />}
                                                
                                                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                                                    <button className="p-1.5 hover:bg-slate-200 rounded text-slate-400 hover:text-amber-500 transition-colors">
                                                        <Star size={16} fill={msg.is_starred ? 'currentColor' : 'none'} className={msg.is_starred ? 'text-amber-500' : ''} />
                                                    </button>
                                                    <button className="p-1.5 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors">
                                                        <Archive size={16} />
                                                    </button>
                                                    <button className="p-1.5 hover:bg-slate-200 rounded text-slate-400 hover:text-red-500 transition-colors">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>

                                                <span className="text-[12px] font-medium text-slate-400 min-w-[45px] text-right">
                                                    {(() => {
                                                        const msgDate = new Date(msg.timestamp * 1000);
                                                        const diff = Math.floor((new Date().getTime() - msgDate.getTime()) / (1000 * 60 * 60 * 24));
                                                        return format(msgDate, diff < 1 ? 'HH:mm' : 'd MMM');
                                                    })()}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div 
                    className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-xl py-1 w-48 animate-in fade-in zoom-in-95 duration-100"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button onClick={() => { handleBatchAction('archive'); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                        <Archive size={14} /> Arxivar
                    </button>
                    <button onClick={() => { handleBatchAction('trash'); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                        <Trash2 size={14} /> Eliminar
                    </button>
                    <div className="border-t border-slate-100 my-1"></div>
                    <button onClick={() => setContextMenu(null)} className="w-full text-left px-4 py-2 text-sm text-slate-400 hover:bg-slate-50">Tancar</button>
                </div>
            )}
            
            {/* Global click to close context menu */}
            {contextMenu && <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />}
        </div>
    );
}
