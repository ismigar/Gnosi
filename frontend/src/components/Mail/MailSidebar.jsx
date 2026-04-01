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
    onSelectCategory
}) {
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);

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
            {/* Account Selector Section - Notion Style Popover placeholder */}
            <div className="p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between px-2 mb-2">
                    <div className="flex items-center gap-2 group cursor-pointer hover:bg-slate-200/50 p-1 rounded-md transition-colors">
                        <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center text-[10px] text-white font-bold">
                            {selectedAccount?.email?.[0].toUpperCase() || 'G'}
                        </div>
                        <span className="text-sm font-semibold text-slate-700 truncate max-w-[120px]">
                            {selectedAccount?.email || 'Ismael Garcia'}
                        </span>
                        <ChevronDown size={12} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                    </div>
                    <button className="p-1.5 hover:bg-slate-200/50 rounded-md text-slate-500 transition-colors">
                        <Plus size={16} />
                    </button>
                </div>

                <div className="relative group mx-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                        type="text"
                        placeholder="Buscar"
                        className="w-full bg-[#efefee] border-transparent text-xs py-1.5 pl-8 pr-2 rounded-md focus:outline-none focus:ring-0 placeholder:text-slate-500"
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

            {/* Footer Items */}
            <div className="px-3 py-4 border-t border-slate-200/60 space-y-0.5">
                <button className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-[#efefee]/70 transition-all font-medium">
                    <Settings size={18} className="text-slate-400" />
                    <span>Configuración</span>
                </button>
                <button className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-[#efefee]/70 transition-all font-medium">
                    <HelpCircle size={18} className="text-slate-400" />
                    <span>Soporte y comentarios</span>
                </button>
            </div>
        </div>
    );
}
