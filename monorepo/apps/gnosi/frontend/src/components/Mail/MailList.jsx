import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, Paperclip, MoreVertical, RefreshCw, CheckCircle2, Archive, Trash2, Filter, Circle, CircleDot } from 'lucide-react';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { ca } from 'date-fns/locale';
import ConfirmModal from '../ConfirmModal';
import { toast } from 'react-hot-toast';

const DEFAULT_CONFIG = {
    sortBy: 'date',
    sortDir: 'desc',
    groupBy: 'date',
    showSnippet: true,
    showTimestamp: true,
};

// ─── MailList ─────────────────────────────────────────────────────────────────
export default function MailList({ account, accounts = [], onSelectMail, folder, category, activeView, selectedMailId, searchQuery = '', onMessagesLoaded, onMailRead, onBatchDone }) {
    const { t, i18n } = useTranslation();
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [hoveredMailId, setHoveredMailId] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const sentinelRef = useRef(null);
    const [confirmConfig, setConfirmConfig] = useState({ isOpen: false });
    // pagination state per account email
    const [pageTokens, setPageTokens] = useState({});   // gmail next_page_token
    const [offsets, setOffsets] = useState({});          // imap offset
    const [totals, setTotals] = useState({});            // total per account

    const buildUrl = (email, { pageToken, offset } = {}) => {
        let url = `/api/mail/messages?email=${encodeURIComponent(email)}&limit=50`;
        // Sempre envia folder. "all" = tots els correus (sense filtre INBOX). "NOT_ARCHIVED" es filtra al client.
        const folderParam = folder === 'NOT_ARCHIVED' ? 'all' : (folder || 'all');
        url += `&folder=${encodeURIComponent(folderParam)}`;
        if (category) url += `&category=${encodeURIComponent(category)}`;
        if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;
        if (offset) url += `&offset=${offset}`;
        return url;
    };

    const fetchMessages = () => {
        setLoading(true);
        setPageTokens({});
        setOffsets({});
        setTotals({});
        const emailList = account?.email
            ? [account.email]
            : accounts.map(a => a.email || a.username).filter(Boolean);

        if (emailList.length === 0) {
            setMessages([]); setLoading(false); onMessagesLoaded?.([]); return;
        }

        Promise.all(emailList.map(email =>
            fetch(buildUrl(email)).then(r => r.json()).catch(() => ({ messages: [], total: 0 }))
        ))
            .then(results => {
                const newTokens = {};
                const newOffsets = {};
                const newTotals = {};
                const emailList2 = account?.email
                    ? [account.email]
                    : accounts.map(a => a.email || a.username).filter(Boolean);
                results.forEach((res, i) => {
                    const em = emailList2[i];
                    newTokens[em] = res.next_page_token || null;
                    newTotals[em] = res.total || 0;
                    newOffsets[em] = (res.messages || []).length;
                });
                setPageTokens(newTokens);
                setOffsets(newOffsets);
                setTotals(newTotals);

                const merged = results.flatMap(r => r.messages || r);
                const seen = new Set();
                const unique = merged.filter(m => {
                    if (!m?.id || seen.has(m.id)) return false;
                    seen.add(m.id); return true;
                });
                setMessages(unique);
                setLoading(false);
                onMessagesLoaded?.(unique);
            })
            .catch(() => setLoading(false));
    };

    const hasMore = (() => {
        const emailList = account?.email
            ? [account.email]
            : accounts.map(a => a.email || a.username).filter(Boolean);
        return emailList.some(em => pageTokens[em] || (totals[em] && offsets[em] < totals[em]));
    })();

    const loadMore = useCallback(() => {
        if (loadingMore) return;
        setLoadingMore(true);
        const emailList = account?.email
            ? [account.email]
            : accounts.map(a => a.email || a.username).filter(Boolean);

        Promise.all(emailList.map(email => {
            const token = pageTokens[email];
            const offset = offsets[email] || 0;
            if (!token && totals[email] && offset >= totals[email]) return Promise.resolve({ messages: [], total: totals[email] });
            return fetch(buildUrl(email, { pageToken: token, offset }))
                .then(r => r.json()).catch(() => ({ messages: [], total: 0 }));
        }))
            .then(results => {
                const newTokens = { ...pageTokens };
                const newOffsets = { ...offsets };
                results.forEach((res, i) => {
                    const em = emailList[i];
                    newTokens[em] = res.next_page_token || null;
                    newOffsets[em] = (newOffsets[em] || 0) + (res.messages || []).length;
                });
                setPageTokens(newTokens);
                setOffsets(newOffsets);

                const newMsgs = results.flatMap(r => r.messages || []);
                setMessages(prev => {
                    const seen = new Set(prev.map(m => m.id));
                    const added = newMsgs.filter(m => m?.id && !seen.has(m.id));
                    return [...prev, ...added];
                });
                setLoadingMore(false);
            })
            .catch(() => setLoadingMore(false));
    }, [loadingMore, account, accounts, pageTokens, offsets, totals, folder, category]);

    useEffect(() => { 
        setUnreadOnly(false); // Reset filter when switching folders/accounts
        fetchMessages(); 
    }, [account, accounts, folder, category]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
                if (selectedIds.size > 0) {
                    handleBatchActionWithConfirm('trash');
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds, messages]);

    const handleBatchActionWithConfirm = (action) => {
        if (selectedIds.size === 0) return;
        
        let confirmMsg = null;
        let confirmTitle = "Confirmar acció";
        const isTrash = folder === 'TRASH' || folder?.toUpperCase() === 'TRASH';

        if (action === 'trash') {
            if (isTrash) {
                confirmTitle = "Eliminar permanentment";
                confirmMsg = `Vols eliminar permanentment aquests ${selectedIds.size} missatges? Aquesta acció no es pot desfer.`;
            } else if (selectedIds.size > 5) {
                confirmTitle = "Moure a la paperera";
                confirmMsg = `Vols moure aquests ${selectedIds.size} missatges a la paperera?`;
            }
        }

        if (confirmMsg) {
            setConfirmConfig({
                isOpen: true,
                title: confirmTitle,
                message: confirmMsg,
                onConfirm: () => {
                    handleBatchAction(action);
                    setConfirmConfig({ isOpen: false });
                }
            });
        } else {
            handleBatchAction(action);
        }
    };

    const handleEmptyFolder = () => {
        const isTrash = folder === 'TRASH' || folder?.toUpperCase() === 'TRASH';
        const title = isTrash ? "Buidar paperera" : "Buidar brossa";
        const msg = isTrash 
            ? (account ? "Vols buidar tota la paperera permanentment? Aquesta acció no es pot desfer." : "Vols buidar la paperera de TOTES les comptes?")
            : (account ? "Vols moure tota la brossa a la paperera?" : "Vols moure la brossa a la paperera de TOTES les comptes?");
        
        setConfirmConfig({
            isOpen: true,
            title,
            message: msg,
            onConfirm: async () => {
                const emailList = account?.email
                    ? [account.email]
                    : accounts.map(a => a.email || a.username).filter(Boolean);

                if (emailList.length === 0) {
                    return;
                }

                setLoading(true);
                try {
                    const results = await Promise.all(emailList.map(email => 
                        fetch(`/api/mail/empty_folder?email=${encodeURIComponent(email)}&folder=${encodeURIComponent(folder)}`, {
                            method: 'POST'
                        })
                    ));
                    
                    const allOk = results.every(r => r.ok);
                    if (!allOk) {
                        const errorRes = results.find(r => !r.ok);
                        const errData = await errorRes.json().catch(() => ({}));
                        throw new Error(errData.detail || "Error al servidor");
                    }

                    toast.success(isTrash ? "Paperera buidada" : "Brossa moguda a la paperera");
                    setLoading(false);
                    fetchMessages();
                    onBatchDone?.();
                    setConfirmConfig({ isOpen: false });
                } catch (err) {
                    setLoading(false);
                    setConfirmConfig({ isOpen: false });
                    console.error("Error buidant carpeta:", err);
                    toast.error(`Error: ${err.message || "No s'ha pogut buidar"}`);
                }
            }
        });
    };

    // Scroll infinit: quan el sentinel és visible i hi ha més, carrega
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting && hasMore && !loadingMore) loadMore(); },
            { threshold: 0.1 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasMore, loadingMore, loadMore]);

    const folderTitleKey = useMemo(() => {
        const map = {
            INBOX: 'inbox_title', SENT: 'sent_title', DRAFTS: 'drafts_title',
            TRASH: 'trash_title', SPAM: 'spam_title', STARRED: 'starred_title', all: 'all_mail_title',
            NOT_ARCHIVED: 'not_archived_title',
            Social: 'category_social', Promotions: 'category_promotions',
            Updates: 'category_updates', Forums: 'category_forums',
        };
        return map[folder] || map[category] || 'inbox_title';
    }, [folder, category]);

    // ── Effective config: activeView overrides defaults ──
    const effectiveConfig = useMemo(() => {
        if (!activeView) return DEFAULT_CONFIG;
        return {
            sortBy: activeView.sort_by || 'date',
            sortDir: activeView.sort_dir || 'desc',
            groupBy: activeView.group_by || 'none',
            showSnippet: DEFAULT_CONFIG.showSnippet,
            showTimestamp: DEFAULT_CONFIG.showTimestamp,
        };
    }, [activeView]);

    // Applies one advanced filter condition to a message
    const applyFilter = (m, f) => {
        const raw = m[f.field];
        const val = f.value;
        switch (f.operator) {
            case 'contains':    return String(raw ?? '').toLowerCase().includes(String(val).toLowerCase());
            case 'starts_with': return String(raw ?? '').toLowerCase().startsWith(String(val).toLowerCase());
            case 'equals':      return String(raw ?? '').toLowerCase() === String(val).toLowerCase();
            case 'is':          return Boolean(raw) === Boolean(val);
            case 'is_not':      return Boolean(raw) !== Boolean(val);
            case 'before':      return (m.timestamp || 0) < new Date(val).getTime() / 1000;
            case 'after':       return (m.timestamp || 0) > new Date(val).getTime() / 1000;
            default:            return true;
        }
    };

    // ── Apply search + view filters ──
    const processedMessages = useMemo(() => {
        let list = [...messages];

        // folder filter (NOT_ARCHIVED is client-side)
        if (folder === 'NOT_ARCHIVED') list = list.filter(m => !m.archived);

        // unread filter
        if (unreadOnly) {
            list = list.filter(m => !m.is_read);
        }

        // search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(m =>
                m.subject?.toLowerCase().includes(q) ||
                m.sender?.toLowerCase().includes(q) ||
                m.snippet?.toLowerCase().includes(q)
            );
        }

        // Advanced view filters
        if (activeView?.filters?.length) {
            const logic = activeView.filter_logic || 'AND';
            list = list.filter(m => {
                const results = activeView.filters.map(f => applyFilter(m, f));
                return logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
            });
        } else {
            // Legacy simple filter
            if (effectiveConfig.filterBy === 'unread') list = list.filter(m => !m.is_read);
            else if (effectiveConfig.filterBy === 'starred') list = list.filter(m => m.is_starred);
            else if (effectiveConfig.filterBy === 'attachment') list = list.filter(m => m.has_attachments);
            else if (effectiveConfig.filterBy === 'not_archived') list = list.filter(m => !m.archived);
        }

        // sort
        list.sort((a, b) => {
            let valA, valB;
            if (effectiveConfig.sortBy === 'sender') { valA = (a.sender || '').toLowerCase(); valB = (b.sender || '').toLowerCase(); }
            else if (effectiveConfig.sortBy === 'subject') { valA = (a.subject || '').toLowerCase(); valB = (b.subject || '').toLowerCase(); }
            else { valA = a.timestamp || 0; valB = b.timestamp || 0; }

            if (valA < valB) return effectiveConfig.sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return effectiveConfig.sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        return list;
    }, [messages, searchQuery, activeView, effectiveConfig, unreadOnly]);

    // ── Thread grouping ──
    const threadedMessages = useMemo(() => {
        const map = new Map();
        processedMessages.forEach(msg => {
            const tid = msg.thread_id || msg.id;
            if (!map.has(tid)) map.set(tid, []);
            map.get(tid).push(msg);
        });
        return Array.from(map.values()).map(msgs => {
            const sorted = [...msgs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            const latest = sorted[0];
            const senders = [...new Set(msgs.map(m => (m.sender || '').split('<')[0].trim()))];
            const unreadCount = msgs.filter(m => !m.is_read).length;
            return {
                ...latest,
                thread_count: msgs.length,
                thread_unread: unreadCount,
                thread_senders: senders,
                thread_messages: sorted, // newest first
            };
        });
    }, [processedMessages]);

    // ── Group ──
    const groupedMessages = useMemo(() => {
        if (effectiveConfig.groupBy === 'none') return { '': threadedMessages };

        const groups = {};
        const now = new Date();

        threadedMessages.forEach(msg => {
            if (!msg) return;
            let groupTitle;

            if (effectiveConfig.groupBy === 'sender') {
                groupTitle = (msg.thread_senders?.[0] || msg.sender || 'Desconegut').split('<')[0].trim();
            } else {
                const ts = msg.timestamp || (Date.now() / 1000);
                const date = parseISO(new Date(ts * 1000).toISOString());
                const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
                if (isToday(date)) groupTitle = t('mail.today');
                else if (isYesterday(date)) groupTitle = t('mail.yesterday');
                else if (diffDays <= 7) groupTitle = t('mail.last_7_days');
                else if (diffDays <= 30) groupTitle = t('mail.last_30_days');
                else groupTitle = format(date, date.getFullYear() < now.getFullYear() ? 'MMMM yyyy' : 'MMMM', { locale: ca });
            }

            if (!groups[groupTitle]) groups[groupTitle] = [];
            groups[groupTitle].push(msg);
        });
        return groups;
    }, [threadedMessages, effectiveConfig.groupBy, t, i18n.language]);

    const toggleSelect = (e, id) => {
        e.stopPropagation();
        const next = new Set(selectedIds);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelectedIds(next);
    };

    const selectAll = () => setSelectedIds(selectedIds.size === messages.length ? new Set() : new Set(messages.map(m => m.id)));

    const handleInlineAction = async (e, action, msg) => {
        e.stopPropagation();
        const effectiveEmail = account?.email || msg.account;
        if (!effectiveEmail) return;
        if (action === 'star') {
            const newVal = !msg.is_starred;
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_starred: newVal } : m));
            await fetch(`/api/mail/messages/${msg.id}/star?email=${encodeURIComponent(effectiveEmail)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ starred: newVal }),
            }).catch(() => {});
        } else if (action === 'archive') {
            setMessages(prev => prev.filter(m => m.id !== msg.id));
            await fetch(`/api/mail/messages/${msg.id}/archive?email=${encodeURIComponent(effectiveEmail)}`, { method: 'POST' }).catch(() => {});
        } else if (action === 'trash') {
            setMessages(prev => prev.filter(m => m.id !== msg.id));
            await fetch(`/api/mail/messages/${msg.id}/trash?email=${encodeURIComponent(effectiveEmail)}`, { method: 'POST' }).catch(() => {});
        }
    };

    const handleBatchAction = async (action) => {
        if (selectedIds.size === 0) return;
        const ids = Array.from(selectedIds);

        // Optimistic UI: update/remove immediately
        if (action === 'trash' || action === 'archive') {
            setMessages(prev => prev.filter(m => !selectedIds.has(m.id)));
        } else if (action === 'read') {
            setMessages(prev => prev.map(m => selectedIds.has(m.id) ? { ...m, is_read: true } : m));
        }
        setSelectedIds(new Set());

        // Group by account when in "all accounts" mode
        const emailsToCall = account?.email
            ? [{ email: account.email, ids }]
            : Object.values(
                messages
                    .filter(m => ids.includes(m.id))
                    .reduce((acc, m) => {
                        const em = m.account_email || m.account;
                        if (!em) return acc;
                        if (!acc[em]) acc[em] = { email: em, ids: [] };
                        acc[em].ids.push(m.id);
                        return acc;
                    }, {})
            );

        await Promise.all(emailsToCall.map(({ email, ids: groupIds }) =>
            fetch(`/api/mail/batch?email=${encodeURIComponent(email)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ids: groupIds }),
            }).catch(() => {})
        ));
        onBatchDone?.();
    };

    return (
        <>
            <div className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 flex items-center justify-between border-b border-[var(--border-primary)] min-h-[72px]">
                {selectedIds.size > 0 ? (
                    <div className="flex items-center justify-between w-full animate-in slide-in-from-top-2 duration-200">
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.size === messages.length}
                                    onChange={selectAll}
                                    className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-blue)] focus:ring-[var(--gnosi-blue)]"
                                />
                                <span className="text-sm font-bold text-[var(--text-primary)]">{selectedIds.size} {t('mail.selected')}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => handleBatchActionWithConfirm('archive')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] flex items-center gap-2 text-sm font-medium transition-all">
                                    <Archive size={16} /> {t('mail.archive_action')}
                                </button>
                                <button onClick={() => handleBatchActionWithConfirm('trash')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--status-error)] flex items-center gap-2 text-sm font-medium transition-all">
                                    <Trash2 size={16} /> {t('mail.delete_action')}
                                </button>
                                <button onClick={() => handleBatchAction('read')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] flex items-center gap-2 text-sm font-medium transition-all">
                                    <CheckCircle2 size={16} /> {t('mail.mark_read')}
                                </button>
                            </div>
                        </div>
                        <button onClick={() => setSelectedIds(new Set())} className="text-sm font-bold text-[var(--gnosi-blue)] hover:opacity-80">
                            {t('mail.cancel')}
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-3 min-w-0">
                            <h2 className="text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
                                {activeView ? activeView.name : t(`mail.${folderTitleKey}`)}
                            </h2>
                            {activeView?.filters?.length > 0 && (
                                <span className="shrink-0 px-2 py-0.5 bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] text-[11px] font-bold rounded-full">
                                    {activeView.filters.length} filtre{activeView.filters.length > 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            {(folder?.toUpperCase() === 'TRASH' || folder?.toUpperCase() === 'SPAM') && (
                                <button
                                    onClick={handleEmptyFolder}
                                    className="p-2 text-[var(--status-error)] hover:bg-[var(--status-error)]/10 rounded-xl transition-all"
                                    title={folder?.toUpperCase() === 'TRASH' ? 'Buida paperera' : 'Buida brossa'}
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                            <button
                                onClick={() => setUnreadOnly(!unreadOnly)}
                                className={`p-2 rounded-xl transition-all ${unreadOnly ? 'bg-[var(--gnosi-blue)] text-white shadow-lg' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                                title={unreadOnly ? "Mostra-ho tot" : "Filtra no llegits"}
                            >
                                <CircleDot size={16} fill={unreadOnly ? 'currentColor' : 'none'} />
                            </button>
                            <div className="w-px h-4 bg-[var(--border-primary)] mx-1" />
                            <button
                                onClick={fetchMessages}
                                disabled={loading}
                                className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg transition-colors disabled:opacity-40 shrink-0"
                                title="Refrescar"
                            >
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Message list */}
            <div className="flex-1 overflow-y-auto">
                {loading && messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 space-y-4">
                        <div className="w-8 h-8 border-2 border-[var(--gnosi-blue)] border-t-transparent rounded-full animate-spin" />
                        <p className="text-sm font-medium text-[var(--text-secondary)]">{t('mail.syncing')}</p>
                    </div>
                ) : Object.keys(groupedMessages).length === 0 || processedMessages.length === 0 ? (
                    <div className="p-12 text-center">
                        <p className="text-[var(--text-secondary)] font-medium">{t('mail.no_messages')}</p>
                    </div>
                ) : (
                    Object.entries(groupedMessages).map(([groupTitle, msgs]) => (
                        <div key={groupTitle} className="mb-2">
                            {groupTitle && (
                                <h3 className="px-6 py-2 text-[12px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                                    {groupTitle}
                                </h3>
                            )}
                            <div className="border-t border-[var(--border-primary)]">
                                {msgs.map(msg => (
                                    <div
                                        key={msg.id}
                                        onClick={() => onSelectMail(msg)}
                                        onMouseEnter={() => setHoveredMailId(msg.id)}
                                        onMouseLeave={() => setHoveredMailId(null)}
                                        onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, msgId: msg.id }); }}
                                        className={`group flex items-center px-4 py-2 cursor-pointer border-b border-[var(--border-primary)] transition-colors
                                            ${selectedMailId === msg.id ? 'bg-[var(--mail-row-selected)]' : 'hover:bg-[var(--bg-secondary)]'}
                                            ${selectedIds.has(msg.id) ? 'bg-[var(--mail-row-selected)]' : ''}`}
                                    >
                                        <div className="flex items-center gap-3 w-full relative">
                                            {/* Sender / Thread participants */}
                                            <div className="flex items-center gap-2 min-w-[200px] max-w-[260px]">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(msg.id)}
                                                    onChange={e => toggleSelect(e, msg.id)}
                                                    onClick={e => e.stopPropagation()}
                                                    className={`w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-blue)] focus:ring-[var(--gnosi-blue)] transition-opacity shrink-0 ${selectedIds.has(msg.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                                />
                                                {(msg.thread_unread > 0) && !selectedIds.has(msg.id) && <div className="w-1.5 h-1.5 rounded-full bg-[var(--gnosi-blue)] shrink-0 group-hover:hidden" />}
                                                <span className={`text-[13.5px] truncate ${msg.thread_unread > 0 ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                                    {msg.thread_senders?.length > 1
                                                        ? msg.thread_senders.slice(0, 2).join(', ') + (msg.thread_senders.length > 2 ? '…' : '')
                                                        : (msg.sender || 'Desconegut').split('<')[0].trim()
                                                    }
                                                </span>
                                                {msg.thread_count > 1 && (
                                                    <span className="shrink-0 text-[11px] font-bold text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded px-1 py-0.5 leading-none">
                                                        {msg.thread_count}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Subject + snippet */}
                                            <div className="flex-1 flex items-center gap-3 min-w-0">
                                                <span className={`text-[13.5px] truncate shrink-0 max-w-[220px] ${!msg.is_read ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                                    {msg.subject || `(${t('common.untitled')})`}
                                                </span>
                                                {effectiveConfig.showSnippet && (
                                                    <span className="text-[13px] text-[var(--text-secondary)] truncate opacity-70">
                                                        {msg.snippet}
                                                    </span>
                                                )}

                                                {/* Hover preview */}
                                                {hoveredMailId === msg.id && (
                                                    <div className="absolute left-1/3 top-full mt-2 z-[var(--z-modal-dropdown)] w-96 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-200 pointer-events-none origin-top-left">
                                                        <div className="flex items-center gap-3 mb-3">
                                                            <div className="w-8 h-8 rounded-xl bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] flex items-center justify-center text-[11px] font-bold uppercase border border-[var(--border-primary)]">
                                                                {msg.sender?.[0]}
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-[13px] font-bold text-[var(--text-primary)] leading-tight">{msg.sender?.split('<')[0]}</span>
                                                                <span className="text-[11px] text-[var(--text-secondary)]">{msg.date}</span>
                                                            </div>
                                                        </div>
                                                        <h4 className="text-[14px] font-extrabold text-[var(--text-primary)] mb-2 leading-snug">{msg.subject}</h4>
                                                        <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed line-clamp-6">{msg.snippet}</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Right side */}
                                            <div className="flex items-center gap-3 shrink-0 ml-4">
                                                {msg.has_attachments && <Paperclip size={14} className="text-[var(--text-secondary)]" />}
                                                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                                                    <button className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] hover:text-[var(--status-warning)] transition-colors" onClick={e => handleInlineAction(e, 'star', msg)}>
                                                        <Star size={15} fill={msg.is_starred ? 'currentColor' : 'none'} className={msg.is_starred ? 'text-[var(--status-warning)]' : ''} />
                                                    </button>
                                                    <button className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors" onClick={e => handleInlineAction(e, 'archive', msg)}>
                                                        <Archive size={15} />
                                                    </button>
                                                    <button className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-colors" onClick={e => handleInlineAction(e, 'trash', msg)}>
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                                {effectiveConfig.showTimestamp && (
                                                    <span className="text-[12px] font-medium text-[var(--text-secondary)] min-w-[42px] text-right">
                                                        {(() => {
                                                            const d = new Date(msg.timestamp * 1000);
                                                            const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
                                                            return format(d, diff < 1 ? 'HH:mm' : 'd MMM');
                                                        })()}
                                                    </span>
                                                )}
                                                <MoreVertical size={15} className="opacity-0 group-hover:opacity-100 text-[var(--text-secondary)] transition-opacity" />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Sentinel per scroll infinit */}
            <div ref={sentinelRef} className="py-3 flex justify-center">
                {loadingMore && <div className="w-4 h-4 border-2 border-[var(--gnosi-blue)] border-t-transparent rounded-full animate-spin" />}
            </div>

            {/* Context menu */}
            {contextMenu && (
                <>
                    <div className="fixed inset-0 z-[var(--z-overlay)]" onClick={() => setContextMenu(null)} />
                    <div
                        className="fixed z-[var(--z-modal)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl py-1 w-48 animate-in fade-in zoom-in-95 duration-100"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                        onClick={e => e.stopPropagation()}
                    >
                        <button onClick={() => { handleBatchAction('archive'); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] flex items-center gap-2">
                            <Archive size={14} /> {t('mail.archive_action')}
                        </button>
                        <button onClick={() => { handleBatchAction('trash'); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] flex items-center gap-2">
                            <Trash2 size={14} /> {t('mail.delete_action')}
                        </button>
                        <div className="border-t border-[var(--border-primary)] my-1" />
                        <button onClick={() => setContextMenu(null)} className="w-full text-left px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]">
                            {t('mail.cancel')}
                        </button>
                    </div>
                </>
            )}
        </div>
        
        <ConfirmModal
            {...confirmConfig}
            onClose={() => setConfirmConfig({ isOpen: false })}
        />
        </>
    );
}
