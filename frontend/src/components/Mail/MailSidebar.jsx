import React, { useState, useEffect } from 'react';
import {
    Inbox, Send, FileText, Trash2, Tag,
    ChevronDown, Plus, Mail, Users, Star,
    ShoppingBag, Archive, Search, Settings, HelpCircle
} from 'lucide-react';

export default function MailSidebar({
    selectedAccount,
    onSelectAccount,
    activeFolder,
    activeCategory,
    onSelectFolder,
    onSelectCategory,
    onCompose
}) {
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAccountSelector, setShowAccountSelector] = useState(false);

    useEffect(() => {
        fetch('/api/integrations')
            .then(res => res.json())
            .then(data => {
                const emailAccounts = data.emails || [];
                setAccounts(emailAccounts);
                if (emailAccounts.length > 0 && !selectedAccount) {
                    onSelectAccount(emailAccounts[0]);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error("Error fetching email accounts:", err);
                setLoading(false);
            });
    }, []);

    const vistes = [
        { id: 'INBOX', label: "Bandeja de entrada", icon: <Inbox size={18} />, type: 'folder' },
        { id: 'STARRED', label: "Destacados", icon: <Star size={18} />, type: 'folder' },
        { id: 'Social', label: 'Social', icon: <Users size={18} />, type: 'category' },
        { id: 'labels', label: 'Labels', icon: <Tag size={18} />, type: 'other' },
        { id: 'Promotions', label: 'Promotions', icon: <ShoppingBag size={18} />, type: 'category' },
    ];

    const correu = [
        { id: 'all', label: 'Todos los correos', icon: <Archive size={18} />, type: 'folder' },
        { id: 'SENT', label: 'Enviados', icon: <Send size={18} />, type: 'folder' },
        { id: 'DRAFTS', label: 'Borradores', icon: <FileText size={18} />, type: 'folder' },
        { id: 'TRASH', label: 'Papelera', icon: <Trash2 size={18} />, type: 'folder' },
    ];

    const handleItemClick = (item) => {
        if (item.type === 'folder') {
            onSelectFolder(item.id);
        } else if (item.type === 'category') {
            onSelectCategory(item.id);
        }
    };

    return (
        <div className="w-64 flex flex-col h-full bg-[#fbfbfa] border-r border-slate-200/60 font-sans">
            <div className="p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between px-1 relative">
                    <div 
                        onClick={() => setShowAccountSelector(!showAccountSelector)}
                        className="flex items-center gap-2 group cursor-pointer hover:bg-slate-200/40 p-1.5 rounded-lg transition-colors flex-1"
                    >
                        <div className="w-5 h-5 rounded bg-indigo-600 flex items-center justify-center text-[10px] text-white font-bold shadow-sm">
                            {selectedAccount?.email?.[0].toUpperCase() || 'G'}
                        </div>
                        <span className="text-[13px] font-medium text-slate-700 truncate max-w-[120px]">
                            {selectedAccount?.email || 'Ismael Garcia'}
                        </span>
                        <ChevronDown size={14} className={`text-slate-400 transition-transform ${showAccountSelector ? 'rotate-180' : ''}`} />
                    </div>
                    <button 
                        onClick={onCompose}
                        className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/40 rounded transition-colors"
                    >
                        <Plus size={18} />
                    </button>

                    {/* Account Selector Dropdown */}
                    {showAccountSelector && (
                        <div className="absolute top-10 left-0 w-full z-50 bg-white border border-slate-200 rounded-xl shadow-xl py-1 animate-in fade-in slide-in-from-top-1 duration-200">
                            <div className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cuentas</div>
                            {accounts.map(acc => (
                                <button
                                    key={acc.email}
                                    onClick={() => {
                                        onSelectAccount(acc);
                                        setShowAccountSelector(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors ${selectedAccount?.email === acc.email ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${selectedAccount?.email === acc.email ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                                    <span className="truncate">{acc.email}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="relative group px-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                        type="text"
                        placeholder="Buscar"
                        className="w-full bg-[#efefee] border-transparent text-[13px] py-1.5 pl-8 pr-2 rounded-md focus:outline-none focus:ring-0 placeholder:text-slate-400"
                    />
                </div>
            </div>

            {/* Navigation Sections */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-6">

                {/* Vistes Section */}
                <div className="space-y-0.5">
                    <div className="px-2 mb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Vistas
                    </div>
                    {vistes.map((item) => {
                        const isActive = (item.type === 'folder' && activeFolder === item.id) ||
                            (item.type === 'category' && activeCategory === item.id);
                        return (
                            <button
                                key={item.id}
                                onClick={() => handleItemClick(item)}
                                className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${isActive
                                    ? 'bg-[#efefee] text-slate-900 font-semibold'
                                    : 'text-slate-600 hover:bg-[#efefee]/70 hover:text-slate-900'
                                    }`}
                            >
                                <span className={isActive ? 'text-indigo-600' : 'text-slate-400'}>
                                    {item.icon}
                                </span>
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                    <button className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:bg-[#efefee]/70 transition-all font-medium">
                        <Plus size={18} className="text-slate-300" />
                        <span>Añadir vista</span>
                    </button>
                </div>

                {/* Correu Section */}
                <div className="space-y-0.5">
                    <div className="px-2 mb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Correo
                    </div>
                    {correu.map((item) => {
                        const isActive = (item.type === 'folder' && activeFolder === item.id);
                        return (
                            <button
                                key={item.id}
                                onClick={() => handleItemClick(item)}
                                className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${isActive
                                    ? 'bg-[#efefee] text-slate-900 font-semibold'
                                    : 'text-slate-600 hover:bg-[#efefee]/70 hover:text-slate-900'
                                    }`}
                            >
                                <span className={isActive ? 'text-indigo-600' : 'text-slate-400'}>
                                    {item.icon}
                                </span>
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </div>

            </div>

            {/* Footer Items - Removed as per user request */}
        </div>
    );
}
