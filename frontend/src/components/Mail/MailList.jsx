import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Star, Paperclip, MoreVertical, RefreshCw, CheckCircle2, Archive, Trash2, Filter, Circle, CircleDot, FolderInput, PanelLeft, Tag } from 'lucide-react';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { ca } from 'date-fns/locale';
import ConfirmModal from '../ConfirmModal';
import { toast } from '../../lib/toast';
import { translateFolderName } from './mailFolderUtils';
import { useMailTags } from '../../hooks/useMailTags';
import MailTagPicker, { TagPill } from './MailTagPicker';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

const cleanName = (addr) =>
    (addr || '').split('<')[0].trim().replace(/^["']+|["']+$/g, '').trim() || addr || '';

// ─── Persistent cache (localStorage) ─────────────────────────────────────────
const LS_PREFIX = 'gnosi_mail_v1_';
const LS_MAX_AGE = 24 * 60 * 60 * 1000; // 24h — we always fetch fresh data, this is just to show something quickly

function lsGet(key) {
    try {
        const raw = localStorage.getItem(LS_PREFIX + key);
        if (!raw) return null;
        const { m, ts } = JSON.parse(raw);
        if (Date.now() - ts > LS_MAX_AGE) { localStorage.removeItem(LS_PREFIX + key); return null; }
        return m;
    } catch { return null; }
}

function lsSet(key, messages) {
    try {
        const payload = JSON.stringify({ m: messages, ts: Date.now() });
        if (payload.length > 600_000) return; // avoid exceeding quota
        localStorage.setItem(LS_PREFIX + key, payload);
    } catch { /* quota exceeded */ }
}

function lsPurgeIds(ids) {
    const idSet = new Set(ids);
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const lsKey = localStorage.key(i);
            if (!lsKey?.startsWith(LS_PREFIX)) continue;
            const raw = localStorage.getItem(lsKey);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed?.m)) continue;
            const filtered = parsed.m.filter(m => !idSet.has(m.id));
            if (filtered.length !== parsed.m.length) {
                localStorage.setItem(lsKey, JSON.stringify({ m: filtered, ts: parsed.ts }));
            }
        }
    } catch { /* quota */ }
}

const DEFAULT_CONFIG = {
    sortBy: 'date',
    sortDir: 'desc',
    groupBy: 'date',
    showSnippet: true,
    showTimestamp: true,
};

// ─── MailList ─────────────────────────────────────────────────────────────────
// Removes a message and all its thread siblings (for Gmail, thread_id !== message_id)
const filterOutThread = (msgs, msgId, threadId) =>
    msgs.filter(m => m.id !== msgId && !(threadId && threadId !== msgId && m.thread_id === threadId));

export default function MailList({ account, accounts = [], onSelectMail, folder, category, activeView, activeTagId, selectedMailId, isComposing = false, searchQuery = '', onMessagesLoaded, onBatchDone, showMailboxSidebar, onToggleMailboxSidebar, removedMailId, readMailId, listRefreshToken, onRecordAction }) {
    const { t, i18n } = useTranslation();
    const enabledAccounts = useMemo(() => accounts.filter(a => a.enabled !== false), [accounts]);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const { tags, getBatchMessageTags, setMessageTags: saveMessageTags, createTag, deleteTag } = useMailTags();
    const [messageTags, setMessageTags] = useState({});
    const [inlineTagPicker, setInlineTagPicker] = useState(null); // { msgId, rect }
    const [loadingMore, setLoadingMore] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [hoveredMailId, setHoveredMailId] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const sentinelRef = useRef(null);
    const listRef = useRef(null);
    const flatMessagesRef = useRef([]);
    const isComposingRef = useRef(isComposing);
    useEffect(() => { isComposingRef.current = isComposing; });
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [confirmConfig, setConfirmConfig] = useState({ isOpen: false });
    const [moveMenu, setMoveMenu] = useState(null); // { x, y, msg, folders }
    const [batchMoveMenu, setBatchMoveMenu] = useState(null); // { x, y, folders }
    const foldersCacheRef = useRef({});
    const msgCacheRef = useRef({});  // stale-while-revalidate: { cacheKey -> messages[] }
    const [syncing, setSyncing] = useState(false); // background update
    // pagination state per account email
    const [pageTokens, setPageTokens] = useState({});   // gmail next_page_token
    const [offsets, setOffsets] = useState({});          // imap offset
    const [totals, setTotals] = useState({});            // total per account

    const buildUrl = (email, { pageToken, offset, force } = {}) => {
        let url = `/api/mail/messages?email=${encodeURIComponent(email)}&limit=50`;
        // Always sends folder. "all" = all emails (no INBOX filter). "NOT_ARCHIVED" is filtered client-side.
        const folderParam = folder === 'NOT_ARCHIVED' ? 'all' : (folder || 'all');
        url += `&folder=${encodeURIComponent(folderParam)}`;
        if (category) url += `&category=${encodeURIComponent(category)}`;
        if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;
        if (offset) url += `&offset=${offset}`;
        if (force) url += `&force=true`;
        return url;
    };

    const fetchMessages = ({ force = false } = {}) => {
        setPageTokens({});
        setOffsets({});
        setTotals({});
        const emailList = account?.email
            ? [account.email]
            : enabledAccounts.map(a => a.email || a.username).filter(Boolean);

        if (emailList.length === 0) {
            setMessages([]); setLoading(false); onMessagesLoaded?.([]); return;
        }

        const cacheKey = `${emailList.join(',')}|${folder || ''}|${category || ''}`;

        // Shows cached data immediately (memory → localStorage → spinner)
        const stale = msgCacheRef.current[cacheKey] || (!force && lsGet(cacheKey));
        if (stale && !force) {
            setMessages(stale);
            setLoading(false);
            onMessagesLoaded?.(stale);
            setSyncing(true); // silent background update
        } else {
            setLoading(true);
        }

        Promise.all(emailList.map(email =>
            fetch(buildUrl(email, { force })).then(r => r.json()).catch(() => ({ messages: [], total: 0 }))
        ))
            .then(results => {
                const newTokens = {};
                const newOffsets = {};
                const newTotals = {};
                const emailList2 = account?.email
                    ? [account.email]
                    : enabledAccounts.map(a => a.email || a.username).filter(Boolean);
                results.forEach((res, i) => {
                    const em = emailList2[i];
                    newTokens[em] = res.next_page_token || null;
                    newTotals[em] = res.total || 0;
                    newOffsets[em] = (res.messages || []).length;
                    if (res.error) toast.error(res.error, { duration: 6000 });
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
                msgCacheRef.current[cacheKey] = unique;
                lsSet(cacheKey, unique); // persist for future reloads
                setMessages(unique);
                setLoading(false);
                setSyncing(false);
                onMessagesLoaded?.(unique);

                // Prefetch common folders in background after INBOX loads
                if ((folder === 'INBOX' || !folder) && !force) {
                    const prefetchFolders = ['SENT', 'DRAFTS', 'TRASH'];
                    prefetchFolders.forEach(pf => {
                        const pfKey = `${emailList2.join(',')}|${pf}|`;
                        if (msgCacheRef.current[pfKey]) return;
                        Promise.all(emailList2.map(em =>
                            fetch(`/api/mail/messages?email=${encodeURIComponent(em)}&limit=50&folder=${encodeURIComponent(pf)}`)
                                .then(r => r.json()).catch(() => ({ messages: [] }))
                        )).then(pfResults => {
                            const pfSeen = new Set();
                            const pfMsgs = pfResults.flatMap(r => r.messages || []).filter(m => {
                                if (!m?.id || pfSeen.has(m.id)) return false;
                                pfSeen.add(m.id); return true;
                            });
                            msgCacheRef.current[pfKey] = pfMsgs;
                            lsSet(pfKey, pfMsgs);
                        }).catch(() => {});
                    });
                }
            })
            .catch(() => { setLoading(false); setSyncing(false); });
    };

    const hasMore = (() => {
        const emailList = account?.email
            ? [account.email]
            : enabledAccounts.map(a => a.email || a.username).filter(Boolean);
        return emailList.some(em => pageTokens[em] || (totals[em] && offsets[em] < totals[em]));
    })();

    const loadMore = useCallback(() => {
        if (loadingMore) return;
        setLoadingMore(true);
        const emailList = account?.email
            ? [account.email]
            : enabledAccounts.map(a => a.email || a.username).filter(Boolean);

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
        setUnreadOnly(false);
        setSelectedIds(new Set());
        const emails = account?.email
            ? [account.email]
            : enabledAccounts.map(a => a.email || a.username).filter(Boolean);
        const cacheKey = `${emails.join(',')}|${folder || ''}|${category || ''}`;
        if (!msgCacheRef.current[cacheKey]) setMessages([]);
        fetchMessages();
    }, [account, accounts, folder, category]);

    // ── Push notifications via Server-Sent Events (IMAP IDLE) ────────────────
    // We keep a `fetchMessages` ref so the EventSource is created once
    // and can always call the most recent version of the fetch.
    const fetchRef = useRef(fetchMessages);
    useEffect(() => { fetchRef.current = fetchMessages; });

    useEffect(() => {
        // If we only show a specific account, we filter by email so that
        // events from other accounts don't trigger an unnecessary reload.
        const url = account?.email
            ? `/api/mail/events?email=${encodeURIComponent(account.email)}`
            : `/api/mail/events`;

        let es;
        try {
            es = new EventSource(url);
        } catch {
            return;
        }

        const onNew = () => {
            // Invalidates cache and redoes a silent fetch (stale-while-revalidate).
            const emails = account?.email
                ? [account.email]
                : enabledAccounts.map(a => a.email || a.username).filter(Boolean);
            const cacheKey = `${emails.join(',')}|${folder || ''}|${category || ''}`;
            delete msgCacheRef.current[cacheKey];
            // fetchMessages takes an options object: pass { force: true } so the
            // push actually bypasses the local cache and the server cache (a bare
            // `true` was ignored, leaving the "new mail" refresh showing stale data).
            fetchRef.current?.({ force: true });
        };

        es.addEventListener('new_message', onNew);
        es.addEventListener('message_removed', onNew);
        es.addEventListener('flags_changed', onNew);
        es.onerror = () => { /* the browser automatically retries */ };

        return () => {
            try { es.close(); } catch { /* no-op */ }
        };
    }, [account, enabledAccounts, folder, category]);

    // Fetch tags for visible messages after load
    useEffect(() => {
        if (!messages.length) return;
        const ids = messages.map(m => m.id);
        getBatchMessageTags(ids).then(data => setMessageTags(data)).catch(() => {});
    }, [messages]);

    // Remove a message that was deleted from MailViewer
    useEffect(() => {
        if (!removedMailId) return;
        setMessages(prev => {
            const threadId = prev.find(m => m.id === removedMailId)?.thread_id;
            const filtered = filterOutThread(prev, removedMailId, threadId);
            Object.keys(msgCacheRef.current).forEach(key => {
                msgCacheRef.current[key] = filterOutThread(msgCacheRef.current[key], removedMailId, threadId);
            });
            lsPurgeIds([removedMailId]);
            return filtered;
        });
    }, [removedMailId]);

    // Mark as read when opened in MailViewer
    useEffect(() => {
        if (readMailId) {
            setMessages(prev => prev.map(m => m.id === readMailId ? { ...m, is_read: true } : m));
        }
    }, [readMailId]);

    // Refresh after undo
    useEffect(() => {
        if (listRefreshToken > 0) fetchMessages({ force: true });
    }, [listRefreshToken]);

    // Reset focus when list changes
    useEffect(() => { setFocusedIndex(-1); }, [account, accounts, folder, category]);

    // Sync focusedIndex with selectedMailId when it changes externally (e.g. deletion/automatic navigation)
    useEffect(() => {
        if (!selectedMailId) return;
        const idx = flatMessagesRef.current.findIndex(m => m.id === selectedMailId);
        if (idx >= 0) setFocusedIndex(idx);
    }, [selectedMailId, messages]);

    // Scroll focused item into view
    useEffect(() => {
        if (focusedIndex < 0 || !listRef.current) return;
        const el = listRef.current.querySelector(`[data-mail-index="${focusedIndex}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [focusedIndex]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (isComposingRef.current) return;
            const active = document.activeElement;
            const isInteractive = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(active.tagName) || active.isContentEditable;
            // Delete/Backspace: allows acting if there's a selection even if focus is on a checkbox
            const isDeleteKey = e.key === 'Delete' || e.key === 'Backspace';
            if (isInteractive && !(isDeleteKey && selectedIds.size > 0)) return;
            const flat = flatMessagesRef.current;

            const viewer = document.querySelector('[data-role="mail-viewer-scroll"]');
            if (viewer && e.key === 'ArrowDown') {
                e.preventDefault();
                viewer.scrollBy({ top: 120, behavior: 'smooth' });
                return;
            }
            if (viewer && e.key === 'ArrowUp') {
                e.preventDefault();
                viewer.scrollBy({ top: -120, behavior: 'smooth' });
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusedIndex(i => Math.min(i + 1, flat.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocusedIndex(i => Math.max(i - 1, 0));
            } else if (e.key === ' ') {
                e.preventDefault();
                if (focusedIndex >= 0 && focusedIndex < flat.length) {
                    const msg = flat[focusedIndex];
                    const next = new Set(selectedIds);
                    next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id);
                    setSelectedIds(next);
                }
            } else if (e.key === 'Enter') {
                if (focusedIndex >= 0 && focusedIndex < flat.length) {
                    onSelectMail(flat[focusedIndex]);
                }
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedIds.size > 0) {
                    handleBatchActionWithConfirm('trash');
                } else if (focusedIndex >= 0 && focusedIndex < flat.length) {
                    const msg = flat[focusedIndex];
                    handleInlineAction({ stopPropagation: () => {} }, 'trash', msg);
                    setFocusedIndex(i => Math.min(i, flat.length - 2));
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds, messages, focusedIndex]);

    // Esc closes each of the dropdown menus (dropdowns: only Esc).
    // Does not interfere with the list navigation (arrows/Enter/Delete) of the
    // global handler above, which doesn't touch Escape.
    useModalKeyboard({ isOpen: !!moveMenu, onClose: () => setMoveMenu(null) });
    useModalKeyboard({ isOpen: !!batchMoveMenu, onClose: () => setBatchMoveMenu(null) });
    useModalKeyboard({ isOpen: !!contextMenu, onClose: () => setContextMenu(null) });

    const purgeMsgFromCache = (msgId, threadId) => {
        const idsToRemove = [msgId];
        Object.keys(msgCacheRef.current).forEach(key => {
            msgCacheRef.current[key] = filterOutThread(msgCacheRef.current[key], msgId, threadId);
        });
        lsPurgeIds(idsToRemove);
    };

    const handleBatchActionWithConfirm = (action) => {
        if (selectedIds.size === 0) return;

        let confirmMsg = null;
        let confirmTitle = t('mail.confirm_action_title', "Confirm action");
        const isTrash = folder === 'TRASH' || folder?.toUpperCase() === 'TRASH';

        if (action === 'trash') {
            if (isTrash) {
                confirmTitle = t('mail.delete_permanently_title', "Delete permanently");
                confirmMsg = t('mail.delete_permanently_confirm', { count: selectedIds.size, defaultValue_one: "Do you want to permanently delete this message? This action cannot be undone.", defaultValue_other: "Do you want to permanently delete these {{count}} messages? This action cannot be undone." });
            } else if (selectedIds.size > 5) {
                confirmTitle = t('mail.move_to_trash_title', "Move to trash");
                confirmMsg = t('mail.move_to_trash_confirm', { count: selectedIds.size, defaultValue: "Do you want to move these {{count}} messages to the trash?" });
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
        const title = isTrash ? t('mail.empty_trash_title', "Empty trash") : t('mail.empty_junk_title', "Empty junk");
        const msg = isTrash
            ? (account ? t('mail.empty_trash_confirm_account', "Do you want to permanently empty the entire trash? This action cannot be undone.") : t('mail.empty_trash_confirm_all', "Do you want to empty the trash for ALL accounts?"))
            : (account ? t('mail.empty_junk_confirm_account', "Do you want to move all junk mail to the trash?") : t('mail.empty_junk_confirm_all', "Do you want to move junk mail to the trash for ALL accounts?"));

        setConfirmConfig({
            isOpen: true,
            title,
            message: msg,
            onConfirm: async () => {
                const emailList = account?.email
                    ? [account.email]
                    : enabledAccounts.map(a => a.email || a.username).filter(Boolean);

                if (emailList.length === 0) {
                    setConfirmConfig({ isOpen: false });
                    toast.error(t('mail.no_accounts_configured', "No accounts configured"));
                    return;
                }

                setLoading(true);
                try {
                    const results = await Promise.all(emailList.map(async email => {
                        const res = await fetch(`/api/mail/empty_folder?email=${encodeURIComponent(email)}&folder=${encodeURIComponent(folder)}`, { method: 'POST' });
                        return { email, ok: res.ok, res };
                    }));

                    const failed = results.filter(r => !r.ok);
                    const succeeded = results.filter(r => r.ok);

                    if (succeeded.length === 0) {
                        const errData = await failed[0].res.json().catch(() => ({}));
                        throw new Error(errData.detail || t('mail.server_error', "Server error"));
                    }

                    if (failed.length > 0) {
                        const errDetails = await Promise.all(failed.map(async f => {
                            const d = await f.res.json().catch(() => ({}));
                            return `${f.email}: ${d.detail || t('errors.unknown')}`;
                        }));
                        toast.error(t('mail.empty_partial_error', "Partially emptied. Errors: {{errors}}", { errors: errDetails.join('; ') }), { duration: 6000 });
                    } else {
                        toast.success(isTrash ? t('mail.trash_emptied', "Trash emptied") : t('mail.junk_moved_to_trash', "Junk mail moved to trash"));
                    }

                    setLoading(false);
                    // Clears cache to avoid showing deleted messages while it refreshes
                    const cacheKey = `${emailList.join(',')}|${folder || ''}|${category || ''}`;
                    msgCacheRef.current[cacheKey] = [];
                    setMessages([]);
                    fetchMessages({ force: true });
                    onBatchDone?.();
                    setConfirmConfig({ isOpen: false });
                } catch (err) {
                    setLoading(false);
                    setConfirmConfig({ isOpen: false });
                    console.error("Error emptying folder:", err);
                    toast.error(`${t('mail.error_prefix', 'Error')}: ${err.message || t('mail.empty_folder_fallback_error', "Couldn't empty it")}`);
                }
            }
        });
    };

    // Refs to read current values inside the observer without re-registering it
    const hasMoreRef = useRef(hasMore);
    const loadingMoreRef = useRef(loadingMore);
    const loadMoreFnRef = useRef(loadMore);
    useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
    useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);
    useEffect(() => { loadMoreFnRef.current = loadMore; }, [loadMore]);

    // Infinite scroll: registered once, reads refs to avoid the loop
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && hasMoreRef.current && !loadingMoreRef.current) {
                    loadMoreFnRef.current();
                }
            },
            { threshold: 0.1 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

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

        // Tag filter
        if (activeTagId) {
            list = list.filter(m => (messageTags[m.id] || []).includes(activeTagId));
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
    }, [messages, searchQuery, activeView, effectiveConfig, unreadOnly, activeTagId, messageTags]);

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
            const senders = [...new Set([...msgs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).map(m => cleanName(m.sender)))];
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

    // Keep ref in sync for keyboard handler (avoids hook ordering issues)
    flatMessagesRef.current = threadedMessages;

    // ── Group ──
    const groupedMessages = useMemo(() => {
        if (effectiveConfig.groupBy === 'none') return { '': threadedMessages };

        const groups = {};
        const now = new Date();

        threadedMessages.forEach(msg => {
            if (!msg) return;
            let groupTitle;

            if (effectiveConfig.groupBy === 'sender') {
                groupTitle = (msg.thread_senders?.[0] || msg.sender || t('mail.unknown_sender', "Unknown")).split('<')[0].trim();
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

    const getFolders = async (email) => {
        if (foldersCacheRef.current[email]?.length) return foldersCacheRef.current[email];
        try {
            const res = await fetch(`/api/mail/folders?email=${encodeURIComponent(email)}`);
            const d = await res.json();
            const folders = d.folders || [];
            foldersCacheRef.current[email] = folders;
            return folders;
        } catch { return []; }
    };

    const handleInlineMoveOpen = async (e, msg) => {
        e.stopPropagation();
        const email = account?.email || msg.account;
        if (!email) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const folders = await getFolders(email);
        setMoveMenu({ x: rect.left, y: rect.bottom + 4, msg, folders });
    };

    const handleInlineMoveToFolder = async (folderName) => {
        if (!moveMenu) return;
        const { msg } = moveMenu;
        setMoveMenu(null);
        const email = account?.email || msg.account;
        if (!email || !msg.id) return;
        setMessages(prev => filterOutThread(prev, msg.id, msg.thread_id));
        try {
            const res = await fetch(`/api/mail/messages/${msg.id}/move?email=${encodeURIComponent(email)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_folder: folderName, imap_uid: msg.imap_uid, imap_folder: msg.imap_folder })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                toast.error(err.detail || t('mail.move_message_failed', "Couldn't move the message"));
                setMessages(prev => [msg, ...prev]);
                return;
            }
        } catch {
            toast.error(t('mail.move_connection_error', "Connection error while moving the message"));
            setMessages(prev => [msg, ...prev]);
            return;
        }
        toast.success(t('mail.moved_to_folder', "Moved to {{folder}}", { folder: folderName }));
        onBatchDone?.();
    };

    const handleBatchMoveOpen = async (e) => {
        const email = account?.email || (enabledAccounts[0]?.email || enabledAccounts[0]?.username);
        if (!email) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const folders = await getFolders(email);
        setBatchMoveMenu({ x: rect.left, y: rect.bottom + 4, folders });
    };

    const handleBatchMoveToFolder = async (folderName) => {
        if (!batchMoveMenu || selectedIds.size === 0) return;
        setBatchMoveMenu(null);
        const ids = Array.from(selectedIds);
        setMessages(prev => prev.filter(m => !selectedIds.has(m.id)));
        setSelectedIds(new Set());

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

        const msgById = Object.fromEntries(messages.map(m => [m.id, m]));
        const removedMsgs = ids.map(id => msgById[id]).filter(Boolean);
        const results = await Promise.all(emailsToCall.map(({ email, ids: groupIds }) =>
            Promise.all(groupIds.map(id => {
                const m = msgById[id] || {};
                return fetch(`/api/mail/messages/${id}/move?email=${encodeURIComponent(email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target_folder: folderName, imap_uid: m.imap_uid, imap_folder: m.imap_folder })
                }).then(r => ({ ok: r.ok, id })).catch(() => ({ ok: false, id }));
            }))
        ));
        const failedIds = new Set(results.flat().filter(r => !r.ok).map(r => r.id));
        if (failedIds.size > 0) {
            const failedMsgs = removedMsgs.filter(m => failedIds.has(m.id));
            setMessages(prev => [...failedMsgs, ...prev]);
            toast.error(t('mail.move_batch_error', { count: failedIds.size, defaultValue_one: "Couldn't move {{count}} message", defaultValue_other: "Couldn't move {{count}} messages" }));
        }
        onBatchDone?.();
    };

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
            setMessages(prev => filterOutThread(prev, msg.id, msg.thread_id));
            purgeMsgFromCache(msg.id, msg.thread_id);
            onRecordAction?.('archive', msg.id, effectiveEmail, { imap_uid: msg.imap_uid, imap_folder: msg.imap_folder });
            await fetch(`/api/mail/messages/${msg.id}/archive?email=${encodeURIComponent(effectiveEmail)}`, { method: 'POST' }).catch(() => {});
        } else if (action === 'trash') {
            setMessages(prev => filterOutThread(prev, msg.id, msg.thread_id));
            purgeMsgFromCache(msg.id, msg.thread_id);
            onRecordAction?.('trash', msg.id, effectiveEmail, { imap_uid: msg.imap_uid, imap_folder: msg.imap_folder });
            if (msg.source === 'vault') {
                await fetch(`/api/mail/drafts/${msg.id}`, { method: 'DELETE' }).catch(() => {});
                onBatchDone?.();
            } else {
                await fetch(`/api/mail/messages/${msg.id}/trash?email=${encodeURIComponent(effectiveEmail)}`, { method: 'POST' }).catch(() => {});
            }
        }
    };

    const handleBatchAction = async (action) => {
        if (selectedIds.size === 0) return;
        const ids = Array.from(selectedIds);
        // Snapshot the removed messages so a failed request can restore them
        // (mirrors the batch-move flow); without this a server error silently
        // dropped messages from the UI while nothing happened on the server.
        const msgById = Object.fromEntries(messages.map(m => [m.id, m]));
        const removedMsgs = ids.map(id => msgById[id]).filter(Boolean);

        // Optimistic UI: update/remove immediately
        if (action === 'trash' || action === 'archive') {
            setMessages(prev => prev.filter(m => !selectedIds.has(m.id)));
            // Purges the cache so they don't reappear on reload
            Object.keys(msgCacheRef.current).forEach(key => {
                msgCacheRef.current[key] = msgCacheRef.current[key].filter(m => !selectedIds.has(m.id));
            });
            lsPurgeIds(ids);
        } else if (action === 'read') {
            setMessages(prev => prev.map(m => selectedIds.has(m.id) ? { ...m, is_read: true } : m));
        }
        setSelectedIds(new Set());

        if (action === 'trash' || action === 'archive') {
            // Vault drafts: calls the specific endpoint for each one
            const vaultIds = messages.filter(m => ids.includes(m.id) && m.source === 'vault').map(m => m.id);
            const imapIds = ids.filter(id => !vaultIds.includes(id));

            const results = await Promise.all([
                ...vaultIds.map(id => fetch(`/api/mail/drafts/${id}`, { method: 'DELETE' })
                    .then(r => ({ ok: r.ok, ids: [id] }))
                    .catch(() => ({ ok: false, ids: [id] }))),
                ...(() => {
                    if (!imapIds.length) return [];
                    const emailsToCall = account?.email
                        ? [{ email: account.email, ids: imapIds }]
                        : Object.values(
                            messages
                                .filter(m => imapIds.includes(m.id))
                                .reduce((acc, m) => {
                                    const em = m.account_email || m.account;
                                    if (!em) return acc;
                                    if (!acc[em]) acc[em] = { email: em, ids: [] };
                                    acc[em].ids.push(m.id);
                                    return acc;
                                }, {})
                        );
                    return emailsToCall.map(({ email, ids: groupIds }) =>
                        fetch(`/api/mail/batch?email=${encodeURIComponent(email)}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action, ids: groupIds }),
                        }).then(r => ({ ok: r.ok, ids: groupIds }))
                          .catch(() => ({ ok: false, ids: groupIds })));
                })(),
            ]);
            // Restore any messages whose delete/archive actually failed.
            const failedIds = new Set(results.filter(r => !r.ok).flatMap(r => r.ids));
            if (failedIds.size > 0) {
                const failedMsgs = removedMsgs.filter(m => failedIds.has(m.id));
                if (failedMsgs.length) setMessages(prev => [...failedMsgs, ...prev]);
                toast.error(t('mail.batch_action_error', { count: failedIds.size, defaultValue: 'Could not update {{count}} message(s)' }));
            }
        } else {
            // For 'read' and other actions, calls the generic batch
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
        }
        onBatchDone?.();
    };

    return (
        <>
            <div className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden">
            {/* Header */}
            <div className="px-4 py-4 flex items-center justify-between border-b border-[var(--border-primary)] min-h-[72px] gap-2">
                <button
                    onClick={onToggleMailboxSidebar}
                    title={showMailboxSidebar ? t('mail.hide_mailbox', "Hide mailbox") : t('mail.show_mailbox', "Show mailbox")}
                    aria-label={showMailboxSidebar ? t('mail.hide_mailbox', "Hide mailbox") : t('mail.show_mailbox', "Show mailbox")}
                    className="hidden p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-lg transition-colors shrink-0 md:inline-flex"
                >
                    <PanelLeft size={16} />
                </button>
                {selectedIds.size > 0 ? (
                    <div className="flex items-center justify-between flex-1 animate-in slide-in-from-top-2 duration-200">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.size === messages.length}
                                    onChange={selectAll}
                                    className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-blue)] focus:ring-[var(--gnosi-blue)]"
                                />
                                <span className="text-sm font-bold text-[var(--text-primary)]">{selectedIds.size} {t('mail.selected')}</span>
                            </div>
                            <div className="flex items-center gap-0.5">
                                <button onClick={() => handleBatchActionWithConfirm('archive')} title={t('mail.archive_selected', "Archive selected")} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] transition-all">
                                    <Archive size={16} />
                                </button>
                                <button onClick={() => handleBatchActionWithConfirm('trash')} title={t('mail.delete_selected', "Delete selected")} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-all">
                                    <Trash2 size={16} />
                                </button>
                                <button onClick={handleBatchMoveOpen} title={t('mail.move_to_folder_title', "Move to folder")} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] transition-all">
                                    <FolderInput size={16} />
                                </button>
                                <button onClick={() => handleBatchAction('read')} title={t('mail.mark_read', "Mark as read")} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] transition-all">
                                    <CheckCircle2 size={16} />
                                </button>
                                <div className="relative">
                                    <button
                                        title={t('mail.assign_tag', "Assign tag")}
                                        onClick={e => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            setInlineTagPicker(prev => prev?.msgId === '__batch__' ? null : { msgId: '__batch__', rect });
                                        }}
                                        className={`p-2 rounded-lg transition-all ${inlineTagPicker?.msgId === '__batch__' ? 'bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                                    >
                                        <Tag size={16} />
                                    </button>
                                    {inlineTagPicker?.msgId === '__batch__' && (
                                        <MailTagPicker
                                            tags={tags}
                                            selectedTagIds={[]}
                                            anchorRect={inlineTagPicker.rect}
                                            onClose={() => setInlineTagPicker(null)}
                                            onToggleTag={async (tagId) => {
                                                const ids = Array.from(selectedIds);
                                                await Promise.all(ids.map(async (msgId) => {
                                                    const current = messageTags[msgId] || [];
                                                    const next = current.includes(tagId)
                                                        ? current.filter(id => id !== tagId)
                                                        : [...current, tagId];
                                                    const msg = messages.find(m => m.id === msgId) || {};
                                                    await saveMessageTags(msgId, next, {
                                                        account_email: account?.email || msg.account || '',
                                                        subject: msg.subject || '',
                                                        sender: msg.sender || '',
                                                        date: msg.date || '',
                                                    }).catch(() => {});
                                                    setMessageTags(prev => ({ ...prev, [msgId]: next }));
                                                }));
                                            }}
                                            onCreateTag={async (data) => { await createTag(data); }}
                                            onDeleteTag={async (id) => { await deleteTag(id); }}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setSelectedIds(new Set())} className="text-sm font-bold text-[var(--gnosi-blue)] hover:opacity-80">
                            {t('mail.cancel')}
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-3 min-w-0 flex-1">
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
                                    title={folder?.toUpperCase() === 'TRASH' ? t('mail.empty_trash_tooltip', "Empty trash") : t('mail.empty_junk_tooltip', "Empty junk")}
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                            <button
                                onClick={() => setUnreadOnly(!unreadOnly)}
                                className={`p-2 rounded-xl transition-all ${unreadOnly ? 'bg-[var(--gnosi-blue)] text-white shadow-lg' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                                title={unreadOnly ? t('mail.show_all', "Show all") : t('mail.filter_unread', "Filter unread")}
                            >
                                <CircleDot size={16} fill={unreadOnly ? 'currentColor' : 'none'} />
                            </button>
                            <div className="w-px h-4 bg-[var(--border-primary)] mx-1" />
                            <button
                                onClick={() => fetchMessages({ force: true })}
                                disabled={loading}
                                className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg transition-colors disabled:opacity-40 shrink-0"
                                title={t('common.refresh')}
                            >
                                <RefreshCw size={16} className={(loading || syncing) ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Message list */}
            <div ref={listRef} className="flex-1 overflow-y-auto" tabIndex={0} style={{ outline: 'none' }}>
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
                                {msgs.map(msg => {
                                    const idx = flatMessagesRef.current.findIndex(m => m.id === msg.id);
                                    const isFocused = focusedIndex === idx;
                                    return (
                                    <div
                                        key={msg.id}
                                        data-mail-index={idx}
                                        onClick={() => { setFocusedIndex(idx); onSelectMail(msg); }}
                                        onMouseEnter={() => setHoveredMailId(msg.id)}
                                        onMouseLeave={() => setHoveredMailId(null)}
                                        onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, msgId: msg.id }); }}
                                        className={`group flex items-center px-4 py-2 cursor-pointer border-b border-[var(--border-primary)] transition-colors
                                            ${isFocused ? 'ring-1 ring-inset ring-[var(--gnosi-blue)]' : ''}
                                            ${selectedMailId === msg.id || selectedIds.has(msg.id) ? 'bg-[var(--mail-row-selected)]' : isFocused ? 'bg-[var(--bg-secondary)]' : 'hover:bg-[var(--bg-secondary)]'}`}
                                    >
                                        <div className="flex items-center gap-3 w-full relative">
                                            {/* Sender / Thread participants */}
                                            <div className="flex items-center gap-2 min-w-[200px] max-w-[260px]">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(msg.id)}
                                                    onChange={e => toggleSelect(e, msg.id)}
                                                    onClick={e => e.stopPropagation()}
                                                    aria-label={t('mail.select_message', 'Select message {{subject}}', {
                                                        subject: msg.subject || t('common.untitled'),
                                                    })}
                                                    className={`w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-blue)] focus:ring-[var(--gnosi-blue)] transition-opacity shrink-0 ${selectedIds.has(msg.id) || isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                                />
                                                {(msg.thread_unread > 0) && !selectedIds.has(msg.id) && <div className="w-1.5 h-1.5 rounded-full bg-[var(--gnosi-blue)] shrink-0 group-hover:hidden" />}
                                                <span className={`text-[13.5px] truncate ${msg.thread_unread > 0 ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                                    {msg.thread_senders?.length > 1
                                                        ? msg.thread_senders.slice(0, 2).join(', ') + (msg.thread_senders.length > 2 ? '…' : '')
                                                        : cleanName(msg.sender) || t('mail.unknown_sender', "Unknown")
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
                                                                <span className="text-[13px] font-bold text-[var(--text-primary)] leading-tight">{cleanName(msg.sender)}</span>
                                                                <span className="text-[11px] text-[var(--text-secondary)]">{msg.date}</span>
                                                            </div>
                                                        </div>
                                                        <h4 className="text-[14px] font-extrabold text-[var(--text-primary)] mb-2 leading-snug">{msg.subject}</h4>
                                                        <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed line-clamp-6">{msg.snippet}</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Tag pills */}
                                            {(messageTags[msg.id] || []).length > 0 && (
                                                <div className="flex items-center gap-1 shrink-0 max-w-[140px] overflow-hidden">
                                                    {(messageTags[msg.id] || []).slice(0, 2).map(tid => {
                                                        const tag = tags.find(t => t.id === tid);
                                                        return tag ? <TagPill key={tid} tag={tag} /> : null;
                                                    })}
                                                    {(messageTags[msg.id] || []).length > 2 && (
                                                        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>+{(messageTags[msg.id] || []).length - 2}</span>
                                                    )}
                                                </div>
                                            )}

                                            {/* Right side */}
                                            <div className="flex items-center gap-3 shrink-0 ml-4">
                                                {msg.has_attachments && <Paperclip size={14} className="text-[var(--text-secondary)]" />}
                                                <div className={`flex items-center gap-0.5 transition-opacity ${(selectedMailId || isComposing) ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}>
                                                    <button
                                                        title={msg.is_starred ? t('mail.unstar', "Remove star") : t('mail.star_action', "Mark as starred")}
                                                        className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] hover:text-[var(--status-warning)] transition-colors"
                                                        onClick={e => handleInlineAction(e, 'star', msg)}
                                                    >
                                                        <Star size={15} fill={msg.is_starred ? 'currentColor' : 'none'} className={msg.is_starred ? 'text-[var(--status-warning)]' : ''} />
                                                    </button>
                                                    <button
                                                        title={t('mail.archive_action', "Archive")}
                                                        className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors"
                                                        onClick={e => handleInlineAction(e, 'archive', msg)}
                                                    >
                                                        <Archive size={15} />
                                                    </button>
                                                    <button
                                                        title={t('mail.move_to_folder_title', "Move to folder")}
                                                        className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors"
                                                        onClick={e => handleInlineMoveOpen(e, msg)}
                                                    >
                                                        <FolderInput size={15} />
                                                    </button>
                                                    <button
                                                        title={t('mail.delete_action', "Delete")}
                                                        className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-colors"
                                                        onClick={e => handleInlineAction(e, 'trash', msg)}
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                    <button
                                                        title={t('mail.labels', "Labels")}
                                                        className={`p-1.5 rounded transition-colors ${inlineTagPicker?.msgId === msg.id ? 'text-[var(--gnosi-blue)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
                                                        onClick={e => {
                                                            e.stopPropagation();
                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            setInlineTagPicker(prev => prev?.msgId === msg.id ? null : { msgId: msg.id, rect });
                                                        }}
                                                    >
                                                        <Tag size={15} />
                                                    </button>
                                                </div>
                                                {inlineTagPicker?.msgId === msg.id && (
                                                    <MailTagPicker
                                                        tags={tags}
                                                        selectedTagIds={messageTags[msg.id] || []}
                                                        anchorRect={inlineTagPicker.rect}
                                                        onClose={() => setInlineTagPicker(null)}
                                                        onToggleTag={async (tagId) => {
                                                            const current = messageTags[msg.id] || [];
                                                            const next = current.includes(tagId)
                                                                ? current.filter(id => id !== tagId)
                                                                : [...current, tagId];
                                                            setMessageTags(prev => ({ ...prev, [msg.id]: next }));
                                                            await saveMessageTags(msg.id, next, {
                                                                account_email: account?.email || msg.account || '',
                                                                subject: msg.subject || '',
                                                                sender: msg.sender || '',
                                                                date: msg.date || '',
                                                            }).catch(() => {});
                                                        }}
                                                        onCreateTag={async (data) => { await createTag(data); }}
                                                        onDeleteTag={async (id) => {
                                                            await deleteTag(id);
                                                            setMessageTags(prev => {
                                                                const updated = { ...prev };
                                                                Object.keys(updated).forEach(k => {
                                                                    updated[k] = updated[k].filter(tid => tid !== id);
                                                                });
                                                                return updated;
                                                            });
                                                        }}
                                                    />
                                                )}
                                                {effectiveConfig.showTimestamp && (
                                                    <span className="text-[12px] font-medium text-[var(--text-secondary)] min-w-[42px] text-right">
                                                        {(() => {
                                                            const d = new Date(msg.timestamp * 1000);
                                                            const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
                                                            return format(d, diff < 1 ? 'HH:mm' : 'd MMM');
                                                        })()}
                                                    </span>
                                                )}
                                                <MoreVertical size={15} className={`text-[var(--text-secondary)] transition-opacity ${selectedMailId ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`} />
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Sentinel for infinite scroll */}
            <div ref={sentinelRef} className="py-3 flex justify-center">
                {loadingMore && <div className="w-4 h-4 border-2 border-[var(--gnosi-blue)] border-t-transparent rounded-full animate-spin" />}
            </div>

            {/* Move menu (inline per message) */}
            {moveMenu && createPortal(
                <>
                    <div className="fixed inset-0" style={{ zIndex: 'var(--z-overlay)' }} onClick={() => setMoveMenu(null)} />
                    <div
                        className="fixed bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl py-1 w-52 animate-in fade-in zoom-in-95 duration-100"
                        style={{ left: moveMenu.x, top: moveMenu.y, zIndex: 'var(--z-popover)' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('mail.move_to_ellipsis', "Move to...")}</div>
                        {moveMenu.folders.length === 0
                            ? <div className="px-3 py-2 text-[13px] text-[var(--text-secondary)]">{t('common.loading')}</div>
                            : moveMenu.folders
                                .filter(f => f.name !== moveMenu.msg?.imap_folder)
                                .map(f => (
                                    <button
                                        key={f.name}
                                        onClick={() => handleInlineMoveToFolder(f.name)}
                                        className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-2"
                                    >
                                        <span className="text-[var(--text-secondary)] text-[10px] font-mono uppercase opacity-60 w-14 shrink-0">{f.type}</span>
                                        {translateFolderName(f.name, t)}
                                    </button>
                                ))
                        }
                    </div>
                </>,
                document.body
            )}

            {/* Batch move menu */}
            {batchMoveMenu && createPortal(
                <>
                    <div className="fixed inset-0" style={{ zIndex: 'var(--z-overlay)' }} onClick={() => setBatchMoveMenu(null)} />
                    <div
                        className="fixed bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl py-1 w-52 animate-in fade-in zoom-in-95 duration-100"
                        style={{ left: batchMoveMenu.x, top: batchMoveMenu.y, zIndex: 'var(--z-popover)' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('mail.move_batch_menu_title', { count: selectedIds.size, defaultValue_one: "Move {{count}} message to...", defaultValue_other: "Move {{count}} messages to..." })}</div>
                        {batchMoveMenu.folders.length === 0
                            ? <div className="px-3 py-2 text-[13px] text-[var(--text-secondary)]">{t('common.loading')}</div>
                            : batchMoveMenu.folders.map(f => (
                                <button
                                    key={f.name}
                                    onClick={() => handleBatchMoveToFolder(f.name)}
                                    className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-2"
                                >
                                    <span className="text-[var(--text-secondary)] text-[10px] font-mono uppercase opacity-60 w-14 shrink-0">{f.type}</span>
                                    {translateFolderName(f.name, t)}
                                </button>
                            ))
                        }
                    </div>
                </>,
                document.body
            )}

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
