import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Reply, ReplyAll, Forward, Trash2, MoreVertical,
    Star, Send, RefreshCw, Sparkles, ExternalLink,
    Archive, Clock, Tag, Mail, Calendar, FolderInput,
    X as CloseIcon, ChevronLeft, ChevronRight, ChevronDown,
    Paperclip, File as FileIcon, FileText, UserPlus, CalendarCheck, User,
    MapPin, Phone, Building, ShieldAlert
} from 'lucide-react';
import { format, addHours, addDays, nextMonday } from 'date-fns';
import { ca } from 'date-fns/locale';
import { toast } from 'react-hot-toast';
import MailBlockEditor from './MailBlockEditor';
import { AddressInput } from './MailAddressInput';
import { DigitalBrainCalendar } from '../Vault/DigitalBrainCalendar';
import axios from 'axios';

function sanitizeHtml(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
}

function MailBody({ bodyHtml, bodyText }) {
    if (bodyHtml) {
        const bodyMatch = bodyHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const content = sanitizeHtml(bodyMatch ? bodyMatch[1] : bodyHtml);
        return (
            <div
                className="prose prose-sm max-w-none text-[var(--text-primary)] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: content }}
            />
        );
    }
    const text = bodyText || '';
    const linked = text.replace(
        /(https?:\/\/[^\s<>"']+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-[var(--gnosi-blue)] underline break-all">$1</a>'
    );
    return (
        <div
            className="text-[15px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words font-sans"
            dangerouslySetInnerHTML={{ __html: linked }}
        />
    );
}

export default function MailViewer({ account, mail: selectedMail, onClose, onMailRead, onActionDone }) {
    const { t } = useTranslation();
    const [mailData, setMailData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [replyBody, setReplyBody] = useState('');
    const [replyMode, setReplyMode] = useState(null);
    const [replyTo, setReplyTo] = useState('');
    const [replyCc, setReplyCc] = useState('');
    const [replyCco, setReplyCco] = useState('');
    const [showReplyCcBcc, setShowReplyCcBcc] = useState(false);
    const [sending, setSending] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [quotedHtml, setQuotedHtml] = useState('');
    const [replyAttachments, setReplyAttachments] = useState([]);
    const replyFileInputRef = useRef(null);
    const [showAvailability, setShowAvailability] = useState(false);
    const [showSnooze, setShowSnooze] = useState(false);
    const [showMove, setShowMove] = useState(false);
    const [moveFolders, setMoveFolders] = useState([]);
    const [moving, setMoving] = useState(false);
    const [calendarData, setCalendarData] = useState({ pages: [], integrations: {}, tables: [] });
    const [calendarTitle, setCalendarTitle] = useState('');
    const [expandedThreadIds, setExpandedThreadIds] = useState(new Set());
    const editorRef = useRef(null);
    const calendarCompRef = useRef(null);
    const [extracting, setExtracting] = useState(false);
    const [extractedEntities, setExtractedEntities] = useState(null);
    const [showEventCalendarPicker, setShowEventCalendarPicker] = useState(null); // stores the event being added
    const [availableCalendars, setAvailableCalendars] = useState([]);

    const threadMessages = selectedMail?.thread_messages || [];
    const olderMessages = threadMessages.slice(1); // newest-first; skip index 0 (current)

    const toggleThreadMsg = (id) => setExpandedThreadIds(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    useEffect(() => {
        setReplyMode(null);
        setReplyBody('');
        setQuotedHtml('');
        setReplyAttachments([]);
        setReplyTo('');
        setReplyCc('');
        setReplyCco('');
        setShowReplyCcBcc(false);
    }, [selectedMail?.id]);

    useEffect(() => {
        if (!selectedMail?.id) { setMailData(null); return; }
        setLoading(true);
        const msgEmail = selectedMail.account || account?.email || '';
        const msgFolder = selectedMail.imap_folder || '';
        const params = new URLSearchParams();
        if (msgEmail) params.set('email', msgEmail);
        if (msgFolder) params.set('folder', msgFolder);
        fetch(`/api/mail/messages/${selectedMail.id}?${params}`)
            .then(res => res.json())
            .then(data => {
                setMailData(data);
                setLoading(false);
                if (!data.is_read) markAsRead(data.id, msgEmail);
            })
            .catch(() => setLoading(false));
    }, [selectedMail]);

    const handleExtractEntities = async () => {
        if (!mailData?.body_text && !mailData?.snippet) return;
        setExtracting(true);
        setExtractedEntities(null);
        try {
            const res = await fetch('/api/mail/ai/extract_entities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: mailData.body_text || mailData.snippet })
            });
            const data = await res.json();
            if (data.events?.length > 0 || data.contacts?.length > 0) {
                setExtractedEntities(data);
                toast.success('S\'han trobat suggeriments intel·ligents');
            } else {
                toast.error('No s\'ha trobat informació rellevant');
            }
        } catch {
            toast.error('Error en l\'anàlisi intel·ligent');
        } finally {
            setExtracting(false);
        }
    };

    const handleAddExtractedContact = async (contact) => {
        try {
            await axios.post('/api/contacts', {
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                company: contact.company,
                notes: contact.notes + `\n\nExtret del correu: ${mailData?.subject}`
            });
            toast.success(`Contacte ${contact.name} afegit`);
            setExtractedEntities(prev => ({
                ...prev,
                contacts: prev.contacts.filter(c => c.email !== contact.email)
            }));
        } catch {
            toast.error('Error afegint el contacte');
        }
    };

    const handleOpenCalendarPicker = async (event) => {
        setShowEventCalendarPicker(event);
        if (availableCalendars.length === 0) {
            try {
                const res = await axios.get(`/api/calendar/calendars?email=${encodeURIComponent(account?.email || '')}`);
                setAvailableCalendars(res.data);
            } catch {
                toast.error('Error carregant calendaris');
            }
        }
    };

    const handleAddExtractedEvent = async (event, calendarId) => {
        try {
            await axios.post(`/api/calendar/events?email=${encodeURIComponent(account?.email || '')}&calendar_id=${calendarId}`, {
                title: event.title,
                start: { dateTime: event.start },
                end: { dateTime: event.end },
                location: event.location,
                description: event.description + `\n\nProvenient del correu: ${mailData?.subject}`
            });
            toast.success(`Esdeveniment "${event.title}" afegit al calendari`);
            setShowEventCalendarPicker(null);
            setExtractedEntities(prev => ({
                ...prev,
                events: prev.events.filter(e => e.title !== event.title)
            }));
        } catch {
            toast.error('Error afegint l\'esdeveniment');
        }
    };

    const markAsRead = (id, msgEmail) => {
        const email = msgEmail || account?.email;
        if (!email) return;
        fetch(`/api/mail/messages/${id}/read?email=${encodeURIComponent(email)}`, {
            method: 'POST'
        })
        .then(() => {
            if (onMailRead) onMailRead(id);
        })
        .catch(() => {});
    };

    const updateMetadata = (key, value) => {
        if (!mailData?.id) return;
        setMailData(prev => ({ ...prev, [key]: value }));
        fetch(`/api/mail/messages/${mailData.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: value })
        }).catch(() => toast.error('Error actualitzant metadades'));
    };

    const handleSendReply = async () => {
        if (!replyBody.trim() || !account?.email || !mailData?.id) return;
        if (!replyTo.trim()) {
            toast.error(t('mail.forward_missing_to'));
            return;
        }
        setSending(true);
        try {
            const fullBody = quotedHtml
                ? `${replyBody}<blockquote style="border-left:3px solid #6366f1;padding-left:0.75rem;color:#888;margin-top:1rem">${quotedHtml}</blockquote>`
                : replyBody;
            const formData = new FormData();
            formData.append('body', fullBody);
            formData.append('to', replyTo);
            if (replyCc) formData.append('cc', replyCc);
            if (replyCco) formData.append('bcc', replyCco);
            replyAttachments.forEach(f => formData.append('attachments', f));
            const res = await fetch(
                `/api/mail/messages/${mailData.id}/reply?email=${encodeURIComponent(account.email)}`,
                { method: 'POST', body: formData }
            );
            await res.json();
            setReplyBody('');
            setReplyTo('');
            setQuotedHtml('');
            setReplyAttachments([]);
            setSending(false);
            setReplyMode(null);
            toast.success(t('mail.sent_ok'));
        } catch {
            setSending(false);
            toast.error(t('mail.send_error'));
        }
    };

    const handleAIAssist = () => {
        if (!mailData?.body_text && !mailData?.snippet) return;
        setAiGenerating(true);
        fetch('/api/mail/ai/generate_draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: mailData.body_text || mailData.snippet })
        })
            .then(res => res.json())
            .then(data => { setReplyBody(data.draft); setAiGenerating(false); toast.success(t('mail.ai_draft_ok')); })
            .catch(() => { setAiGenerating(false); toast.error(t('mail.ai_draft_error')); });
    };

    const detectFormLinks = (html, text) => {
        const patterns = [
            /https:\/\/forms\.gle\/[a-zA-Z0-9_-]+/g,
            /https:\/\/docs\.google\.com\/forms\/[a-zA-Z0-9_\-\/]+/g,
            /https:\/\/[a-zA-Z0-9-]+\.typeform\.com\/to\/[a-zA-Z0-9_\-]+/g,
            /https:\/\/forms\.office\.com\/[a-zA-Z0-9_\-]+/g
        ];
        const content = html || text || '';
        const found = [];
        patterns.forEach(p => {
            const matches = content.match(p);
            if (matches) found.push(...matches);
        });
        return [...new Set(found)];
    };

    const formLinks = detectFormLinks(mailData?.body_html, mailData?.body_text);

    const handleFillForm = async (url) => {
        toast.success('Iniciant autocompletat intel·ligent...');
        try {
            // Carregar el perfil actual del búnker
            const res = await axios.get('/api/identity');
            const profile = res.data;

            if (window.electronAPI?.openFormFiller) {
                window.electronAPI.openFormFiller(url, profile);
            } else {
                // Fallback si no estem en Electron
                window.open(url, '_blank');
                toast.error('L\'omplert automàtic només està disponible en l\'aplicació d\'escriptori');
            }
        } catch (error) {
            console.error('Error carregant perfil per omplir formulari:', error);
            window.open(url, '_blank');
        }
    };

    const handleAddToVault = async () => {
        if (!mailData) return;
        try {
            const title = mailData.subject || 'Correu sense assumpte';
            const content = `# ${title}\n\n**De:** ${mailData.sender}\n**Data:** ${mailData.date}\n\n---\n\n${mailData.body_text || ''}`;
            await axios.post('/api/vault/pages', { title, content, metadata: { type: 'Mail', source: 'mail', sender: mailData.sender, date: mailData.date } });
            toast.success(t('mail.added_to_vault'));
        } catch {
            toast.error(t('mail.add_to_vault_error'));
        }
    };

    const handleSnooze = async (option) => {
        if (!mailData?.id) return;
        setShowSnooze(false);
        const now = new Date();
        const snoozeMap = {
            '1h': addHours(now, 1),
            'tomorrow': addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8), 1),
            'next_week': nextMonday(now)
        };
        const snooze_until = snoozeMap[option]?.toISOString();
        if (!snooze_until) return;
        try {
            await fetch(`/api/mail/messages/${mailData.id}/snooze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ snooze_until })
            });
            toast.success(t('mail.snooze_ok'));
        } catch {
            toast.error('Error establint recordatori');
        }
    };

    const fetchCalendarResources = async () => {
        try {
            const [pagesRes, integrationsRes, tablesRes] = await Promise.all([
                axios.get('/api/vault/pages'),
                axios.get('/api/integrations'),
                axios.get('/api/vault/tables'),
            ]);
            setCalendarData({ pages: pagesRes.data, integrations: integrationsRes.data, tables: tablesRes.data });
        } catch {
            toast.error('Error carregant el calendari');
        }
    };

    const handleInsertAvailability = () => {
        setShowAvailability(true);
        if (calendarData.pages.length === 0) fetchCalendarResources();
    };

    useEffect(() => {
        if (!showAvailability) return;
        const handler = (e) => { if (e.key === 'Escape') setShowAvailability(false); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [showAvailability]);

    const handleSlotSelection = (selection) => {
        if (!editorRef.current) return;
        const { start, end, allDay } = selection;
        const startStr = format(start, allDay ? 'd MMMM' : 'd MMMM HH:mm', { locale: ca });
        const endStr = end ? format(end, allDay ? 'd MMMM' : 'HH:mm', { locale: ca }) : '';
        const text = allDay
            ? t('mail.availability_day', { date: startStr })
            : t('mail.availability_range', { start: startStr, end: endStr });

        const editor = editorRef.current;
        if (editor?.insertBlocks) {
            editor.insertBlocks([{ type: 'paragraph', content: text }], editor.getTextCursorPosition().block, 'after');
        }
        setShowAvailability(false);
        toast.success(t('mail.availability_inserted'));
    };

    const buildQuotedHtml = (data) => {
        const header = `<strong>${t('mail.from_label')}:</strong> ${data.sender || ''} &nbsp;|&nbsp; <strong>${t('mail.date_label')}:</strong> ${data.date || ''} &nbsp;|&nbsp; <strong>${t('mail.subject_label')}:</strong> ${data.subject || ''}`;
        const content = data.body_html
            ? sanitizeHtml(data.body_html)
            : (data.body_text || '').replace(/\n/g, '<br>');
        return `<div style="font-size:12px;margin-bottom:6px;opacity:0.7">${header}</div><hr style="opacity:0.2;margin:6px 0">${content}`;
    };

    const handleReply = () => {
        if (!mailData) return;
        setReplyMode('reply');
        setReplyTo(mailData.sender || '');
        setReplyCc('');
        setReplyCco('');
        setShowReplyCcBcc(false);
        setReplyBody('');
        setQuotedHtml(buildQuotedHtml(mailData));
        setReplyAttachments([]);
        setTimeout(() => document.getElementById('reply-area')?.scrollIntoView({ behavior: 'smooth' }), 100);
    };

    const handleReplyAll = () => {
        if (!mailData) return;
        setReplyMode('reply_all');
        setReplyTo(mailData.sender || '');
        setReplyCc(mailData.recipient || '');
        setReplyCco('');
        setShowReplyCcBcc(!!mailData.recipient);
        setReplyBody('');
        setQuotedHtml(buildQuotedHtml(mailData));
        setReplyAttachments([]);
        setTimeout(() => document.getElementById('reply-area')?.scrollIntoView({ behavior: 'smooth' }), 100);
    };

    const handleForward = () => {
        if (!mailData) return;
        setReplyMode('forward');
        setReplyTo('');
        setReplyCc('');
        setReplyCco('');
        setShowReplyCcBcc(false);
        setReplyBody('');
        setQuotedHtml(buildQuotedHtml(mailData));
        setReplyAttachments([]);
        setTimeout(() => document.getElementById('reply-area')?.scrollIntoView({ behavior: 'smooth' }), 100);
    };

    const effectiveEmail = account?.email || mailData?.account;

    const handleToggleStar = () => {
        if (!mailData || !effectiveEmail) return;
        const newValue = !mailData.is_starred;
        setMailData(prev => ({ ...prev, is_starred: newValue }));
        fetch(`/api/mail/messages/${mailData.id}/star?email=${encodeURIComponent(effectiveEmail)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ starred: newValue })
        }).catch(() => toast.error('Error marcant'));
        toast.success(newValue ? t('mail.starred_added') : t('mail.starred_removed'));
    };

    const handleArchive = () => {
        if (!mailData?.id || !effectiveEmail) return;
        fetch(`/api/mail/messages/${mailData.id}/archive?email=${encodeURIComponent(effectiveEmail)}`, { method: 'POST' })
            .then(() => {
                toast.success(t('mail.archive_ok'));
                onActionDone?.();
            })
            .catch(() => toast.error(t('mail.archive_error')));
    };

    const handleDelete = () => {
        if (!mailData?.id || !effectiveEmail) return;
        fetch(`/api/mail/messages/${mailData.id}/trash?email=${encodeURIComponent(effectiveEmail)}`, { method: 'POST' })
            .then(() => {
                toast.success(t('mail.delete_ok'));
                onActionDone?.();
            })
            .catch(() => toast.error(t('mail.delete_error')));
    };

    const isSpam = mailData?.category === 'SPAM' || 
                   mailData?.is_spam || 
                   mailData?.imap_folder?.toUpperCase() === 'SPAM' ||
                   mailData?.imap_folder?.toUpperCase() === 'JUNK' ||
                   mailData?.imap_folder?.toUpperCase() === 'CORREU BROSSA';

    const handleToggleSpam = () => {
        if (!mailData || !effectiveEmail) return;
        const newValue = !isSpam;
        
        setMailData(prev => ({ ...prev, is_spam: newValue, category: newValue ? 'SPAM' : 'Main' }));
        
        fetch(`/api/mail/messages/${mailData.id}/spam?email=${encodeURIComponent(effectiveEmail)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spam: newValue })
        })
        .then(() => {
            toast.success(newValue ? t('mail.spam_added') : t('mail.spam_removed'));
            onActionDone?.();
            if (newValue) onClose?.(); // Si marquem com a spam, tanquem el visor
        })
        .catch(() => {
            toast.error(t('mail.error_updating'));
            setMailData(prev => ({ ...prev, is_spam: !newValue, category: !newValue ? 'SPAM' : 'Main' }));
        });
    };

    const handleOpenMove = async () => {
        if (!effectiveEmail) return;
        setShowMove(v => !v);
        if (moveFolders.length === 0) {
            try {
                const res = await fetch(`/api/mail/folders?email=${encodeURIComponent(account.email)}`);
                const data = await res.json();
                setMoveFolders(data.folders || []);
            } catch {
                setMoveFolders([]);
            }
        }
    };

    const handleMoveToFolder = async (folderName) => {
        if (!mailData?.id || !effectiveEmail || moving) return;
        setMoving(true);
        setShowMove(false);
        try {
            const res = await fetch(
                `/api/mail/messages/${mailData.id}/move?email=${encodeURIComponent(effectiveEmail)}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_folder: folderName }) }
            );
            if (res.ok) {
                toast.success(`Mogut a ${folderName}`);
                if (onClose) onClose();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err.detail || 'Error movent el missatge');
            }
        } catch {
            toast.error('Error movent el missatge');
        } finally {
            setMoving(false);
        }
    };

    if (!selectedMail) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-primary)]">
                <div className="w-24 h-24 rounded-3xl bg-[var(--bg-secondary)] flex items-center justify-center mb-6 shadow-inner">
                    <Mail size={40} className="text-[var(--border-primary)]" />
                </div>
                <p className="text-lg font-semibold text-[var(--text-secondary)]">{t('mail.select_mail')}</p>
                <p className="text-sm text-[var(--text-secondary)] opacity-60">{t('mail.select_mail_hint')}</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-primary)]">
                <div className="w-12 h-12 border-4 border-[var(--gnosi-blue)] border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-[var(--text-secondary)] font-medium">{t('mail.loading')}</p>
            </div>
        );
    }

    const replyModeLabel = replyMode === 'forward' ? t('mail.forward_title') : replyMode === 'reply_all' ? t('mail.reply_all_title') : t('mail.reply_title');

    return (
        <div className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden font-sans">
            {/* Action Bar */}
            <div className="h-14 border-b border-[var(--border-primary)] px-6 flex items-center justify-between bg-[var(--bg-primary)]/80 backdrop-blur-xl sticky top-0 z-20 overflow-x-auto scrollbar-hide">
                <div className="flex items-center gap-1 shrink-0">
                    <button onClick={handleAddToVault} title={t('mail.add_to_vault')} className="p-2 hover:bg-[var(--sidebar-item-active)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] transition-all flex items-center gap-2 text-sm font-medium">
                        <ExternalLink size={16} />
                        <span className="hidden xl:block">{t('mail.add_to_vault')}</span>
                    </button>
                    <div className="w-px h-5 bg-[var(--border-primary)] mx-1" />
                    <button
                        onClick={handleExtractEntities}
                        disabled={extracting}
                        title="Anàlisi intel·ligent"
                        className={`p-2 rounded-xl transition-all flex items-center gap-2 ${extracting ? 'bg-[var(--bg-secondary)] text-[var(--gnosi-blue)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-blue)]'}`}
                    >
                        {extracting ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
                        <span className="hidden xl:block text-xs font-bold uppercase tracking-wider">Smart Scan</span>
                    </button>
                    <div className="w-px h-5 bg-[var(--border-primary)] mx-1" />
                    <button onClick={handleReply} title={t('mail.reply_title')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"><Reply size={16} /></button>
                    <button onClick={handleReplyAll} title={t('mail.reply_all_title')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"><ReplyAll size={16} /></button>
                    <button onClick={handleForward} title={t('mail.forward_title')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"><Forward size={16} /></button>
                    <div className="w-px h-5 bg-[var(--border-primary)] mx-1" />
                    <button onClick={handleArchive} title={t('mail.archive_action')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"><Archive size={16} /></button>

                    {/* Move to folder dropdown */}
                    <div className="relative">
                        <button
                            title="Moure a carpeta"
                            onClick={handleOpenMove}
                            disabled={moving}
                            className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"
                        >
                            {moving ? <div className="w-[16px] h-[16px] border-2 border-current border-t-transparent rounded-full animate-spin" /> : <FolderInput size={16} />}
                        </button>
                        {showMove && (
                            <>
                                <div className="fixed inset-0 z-[var(--z-overlay)]" onClick={() => setShowMove(false)} />
                                <div className="absolute left-0 top-full mt-1 z-[var(--z-modal)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg py-1 w-52 animate-in fade-in zoom-in-95 duration-150">
                                    <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Moure a...</div>
                                    {moveFolders.length === 0
                                        ? <div className="px-3 py-2 text-[13px] text-[var(--text-secondary)]">Carregant...</div>
                                        : moveFolders
                                            .filter(f => f.name !== mailData?.imap_folder)
                                            .map(f => (
                                                <button
                                                    key={f.name}
                                                    onClick={() => handleMoveToFolder(f.name)}
                                                    className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-2"
                                                >
                                                    <span className="text-[var(--text-secondary)] text-[10px] font-mono uppercase opacity-60 w-14 shrink-0">{f.type}</span>
                                                    {f.name}
                                                </button>
                                            ))
                                    }
                                </div>
                            </>
                        )}
                    </div>

                    {/* Snooze dropdown */}
                    <div className="relative">
                        <button
                            title={t('mail.snooze')}
                            onClick={() => setShowSnooze(v => !v)}
                            className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all flex items-center gap-1"
                        >
                            <Clock size={16} />
                        </button>
                        {showSnooze && (
                            <>
                                <div className="fixed inset-0 z-[var(--z-overlay)]" onClick={() => setShowSnooze(false)} />
                                <div className="absolute left-0 top-full mt-1 z-[var(--z-modal)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg py-1 w-48 animate-in fade-in zoom-in-95 duration-150">
                                    <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('mail.snooze')}</div>
                                    {[['1h', 'snooze_1h'], ['tomorrow', 'snooze_tomorrow'], ['next_week', 'snooze_next_week']].map(([key, labelKey]) => (
                                        <button key={key} onClick={() => handleSnooze(key)} className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors">
                                            {t(`mail.${labelKey}`)}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    <button onClick={handleDelete} title={t('mail.delete_action')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-all"><Trash2 size={16} /></button>
                    <button 
                        onClick={handleToggleSpam} 
                        title={isSpam ? "No és brossa (Moure a entrada)" : "Marca com a brossa"} 
                        className={`p-2 rounded-xl transition-all flex items-center gap-2 text-sm font-medium ${
                            isSpam 
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-amber-600'
                        }`}
                    >
                        <ShieldAlert size={16} fill={isSpam ? 'currentColor' : 'none'} />
                    </button>
                    <div className="w-px h-5 bg-[var(--border-primary)] mx-1" />
                    <button onClick={onClose} title={t('common.close')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all active:scale-90"><CloseIcon size={16} /></button>
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                        onClick={handleToggleStar}
                        className={`p-2 rounded-xl transition-all ${mailData?.is_starred ? 'text-[var(--status-warning)] bg-[var(--bg-secondary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                    >
                        <Star size={16} fill={mailData?.is_starred ? 'currentColor' : 'none'} />
                    </button>
                    <button className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"><MoreVertical size={16} /></button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                <div className="max-w-5xl mx-auto px-6 lg:px-12 pt-8">
                        <h1 className="text-2xl font-extrabold text-[var(--text-primary)] leading-tight mb-6 tracking-tight">
                            {mailData?.subject}
                        </h1>

                        <div className="flex items-center justify-between gap-4 mb-6 pb-6 border-b border-[var(--border-primary)]">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-lg shadow-lg shrink-0">
                                    {mailData?.sender?.[0]?.toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <div className="font-bold text-[var(--text-primary)] text-base leading-tight truncate">
                                        {mailData?.sender?.split('<')[0].trim()}
                                    </div>
                                    <div className="text-xs text-[var(--text-secondary)] font-medium truncate">
                                        Per a: {mailData?.recipient}
                                        {mailData?.cc && <span className="block italic mt-0.5">CC: {mailData.cc}</span>}
                                        {mailData?.bcc && <span className="block italic mt-0.5">BCC: {mailData.bcc}</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-sm font-bold text-[var(--text-primary)]">
                                    {mailData?.timestamp ? format(new Date(mailData.timestamp * 1000), 'd MMM yyyy', { locale: ca }) : ''}
                                </div>
                                <div className="text-xs text-[var(--text-secondary)] font-medium tracking-wide uppercase">
                                    {mailData?.timestamp ? format(new Date(mailData.timestamp * 1000), 'HH:mm') : ''}
                                </div>
                            </div>
                        </div>

                    {/* Meta badges */}
                    <div className="flex flex-wrap gap-3 items-center mb-8">
                        <div className="flex items-center gap-1.5 bg-[var(--bg-secondary)] px-2 py-1 rounded-lg border border-[var(--border-primary)]">
                            <Tag size={12} className="text-[var(--text-secondary)]" />
                            <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{mailData?.category || 'General'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-[var(--sidebar-item-active)] px-2 py-1 rounded-lg border border-[var(--border-primary)]">
                            <div className="w-1.5 h-1.5 rounded-full bg-[var(--gnosi-blue)]" />
                            <span className="text-[10px] font-bold text-[var(--gnosi-blue)] uppercase tracking-widest">Inbox</span>
                        </div>
                        {formLinks.length > 0 && (
                            <div className="flex gap-2">
                                {formLinks.map((link, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleFillForm(link)}
                                        className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white px-2.5 py-1 rounded-lg shadow-sm hover:shadow-md transition-all animate-pulse hover:animate-none"
                                    >
                                        <FileText size={12} />
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Omplir Formulari</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Older thread messages (collapsed) */}
                    {olderMessages.length > 0 && (
                        <div className="space-y-2 mb-4">
                            {olderMessages.map(msg => {
                                const isExpanded = expandedThreadIds.has(msg.id);
                                const senderName = (msg.sender || '').split('<')[0].trim();
                                return (
                                    <div
                                        key={msg.id}
                                        className="border border-[var(--border-primary)] rounded-xl overflow-hidden"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => toggleThreadMsg(msg.id)}
                                            className="w-full flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left gap-4"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-7 h-7 rounded-lg bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] flex items-center justify-center text-[11px] font-bold uppercase shrink-0">
                                                    {senderName[0] || '?'}
                                                </div>
                                                <span className={`text-[13px] font-semibold truncate ${!msg.is_read ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                                    {senderName}
                                                </span>
                                                {!isExpanded && (
                                                    <span className="text-[12px] text-[var(--text-secondary)] truncate opacity-70">
                                                        {msg.snippet}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="text-[12px] text-[var(--text-secondary)]">
                                                    {msg.timestamp ? format(new Date(msg.timestamp * 1000), 'd MMM HH:mm', { locale: ca }) : ''}
                                                </span>
                                                <ChevronDown
                                                    size={14}
                                                    className={`text-[var(--text-secondary)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                />
                                            </div>
                                        </button>
                                        {isExpanded && (
                                            <div className="px-5 py-4 bg-[var(--bg-primary)]">
                                                <MailBody
                                                    bodyHtml={msg.body_html}
                                                    bodyText={msg.body_text || msg.snippet || ''}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Extracted Entities Panel */}
                    {extractedEntities && (extractedEntities.events.length > 0 || extractedEntities.contacts.length > 0) && (
                        <div className="bg-[var(--bg-secondary)]/50 border border-[var(--border-primary)] rounded-3xl p-8 mb-12 animate-in fade-in slide-in-from-top-4 duration-500 backdrop-blur-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg">
                                    <Sparkles size={20} />
                                </div>
                                <h3 className="text-xl font-bold text-[var(--text-primary)]">Suggeriments intel·ligents</h3>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Events */}
                                {extractedEntities.events.length > 0 && (
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest flex items-center gap-2">
                                            <CalendarCheck size={14} /> Calendari
                                        </h4>
                                        {extractedEntities.events.map((event, idx) => (
                                            <div key={idx} className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group">
                                                <div className="font-bold text-[var(--text-primary)] mb-2 group-hover:text-[var(--gnosi-blue)] transition-colors">{event.title}</div>
                                                <div className="text-xs text-[var(--text-secondary)] space-y-1.5 mb-4">
                                                    <div className="flex items-center gap-2">
                                                        <Clock size={12} className="opacity-60" />
                                                        {event.start ? format(new Date(event.start), 'd MMM, HH:mm', { locale: ca }) : 'Data no especificada'}
                                                    </div>
                                                    {event.location && (
                                                        <div className="flex items-center gap-2">
                                                            <MapPin size={12} className="opacity-60" />
                                                            {event.location}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => handleOpenCalendarPicker(event)}
                                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--sidebar-item-active)] hover:bg-[var(--gnosi-blue)] text-[var(--gnosi-blue)] hover:text-white rounded-xl text-xs font-bold transition-all"
                                                >
                                                    <CalendarCheck size={14} /> Afegir al calendari
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Contacts */}
                                {extractedEntities.contacts.length > 0 && (
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest flex items-center gap-2">
                                            <UserPlus size={14} /> Contactes
                                        </h4>
                                        {extractedEntities.contacts.map((contact, idx) => (
                                            <div key={idx} className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group">
                                                <div className="font-bold text-[var(--text-primary)] mb-2 group-hover:text-[var(--gnosi-blue)] transition-colors">{contact.name}</div>
                                                <div className="text-xs text-[var(--text-secondary)] space-y-1.5 mb-4">
                                                    {contact.email && (
                                                        <div className="flex items-center gap-2">
                                                            <Mail size={12} className="opacity-60" />
                                                            {contact.email}
                                                        </div>
                                                    )}
                                                    {contact.phone && (
                                                        <div className="flex items-center gap-2">
                                                            <Phone size={12} className="opacity-60" />
                                                            {contact.phone}
                                                        </div>
                                                    )}
                                                    {contact.company && (
                                                        <div className="flex items-center gap-2">
                                                            <Building size={12} className="opacity-60" />
                                                            {contact.company}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => handleAddExtractedContact(contact)}
                                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--sidebar-item-active)] hover:bg-[var(--status-success)] text-[var(--gnosi-blue)] hover:text-white rounded-xl text-xs font-bold transition-all"
                                                >
                                                    <UserPlus size={14} /> Afegir als contactes
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <MailBody
                        bodyHtml={mailData?.body_html}
                        bodyText={mailData?.body_text || mailData?.snippet || ''}
                    />

                    {/* Reply section */}
                    <div className="pt-20 pb-10" id="reply-area">
                        <div className="bg-[var(--reply-box-bg)] rounded-3xl border-2 border-[var(--border-primary)] p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-xl bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] flex items-center justify-center">
                                        {replyMode === 'forward' ? <Forward size={16} /> : replyMode === 'reply_all' ? <ReplyAll size={16} /> : <Reply size={16} />}
                                    </div>
                                    <h3 className="font-bold text-[var(--text-primary)]">{replyModeLabel}</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleInsertAvailability}
                                        className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-xl text-sm font-bold transition-all hover:shadow-md active:scale-95"
                                    >
                                        <Calendar size={14} />
                                        {t('mail.availability')}
                                    </button>
                                    <button
                                        onClick={handleAIAssist}
                                        disabled={aiGenerating}
                                        className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-primary)] hover:bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] border border-[var(--border-primary)] rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
                                    >
                                        {aiGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                        {t('mail.ai_draft')}
                                    </button>
                                </div>
                            </div>

                            <div className="mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                                <AddressInput
                                    label={t('mail.to_label')}
                                    placeholder="destinatari@exemple.com"
                                    value={replyTo}
                                    onChange={setReplyTo}
                                    accountEmail={account?.email}
                                />
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => setShowReplyCcBcc(v => !v)}
                                        className="text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] transition-colors py-1"
                                    >
                                        CC/CCO <ChevronDown size={10} className={`inline transition-transform ${showReplyCcBcc ? 'rotate-180' : ''}`} />
                                    </button>
                                </div>
                                {showReplyCcBcc && (
                                    <div className="animate-in slide-in-from-top-1 duration-150">
                                        <AddressInput
                                            label="CC"
                                            placeholder="cc@exemple.com"
                                            value={replyCc}
                                            onChange={setReplyCc}
                                            accountEmail={account?.email}
                                        />
                                        <AddressInput
                                            label="CCO"
                                            placeholder="cco@exemple.com"
                                            value={replyCco}
                                            onChange={setReplyCco}
                                            accountEmail={account?.email}
                                        />
                                    </div>
                                )}
                            </div>

                            <MailBlockEditor
                                initialContent={replyBody}
                                onChange={setReplyBody}
                                editorRef={editorRef}
                                onAttachFile={file => setReplyAttachments(prev => {
                                    if (prev.some(f => f.name === file.name && f.size === file.size)) return prev;
                                    return [...prev, file];
                                })}
                            />

                            {/* Quoted message */}
                            {quotedHtml && (
                                <div className="mt-4 border-l-4 border-[var(--gnosi-blue)] pl-4 py-2 text-[var(--text-secondary)] text-[13px] leading-relaxed opacity-70 rounded-r-lg bg-[var(--bg-secondary)]/30">
                                    <div className="text-[10px] font-bold uppercase tracking-widest mb-2 text-[var(--gnosi-blue)] opacity-60">
                                        {replyMode === 'forward' ? t('mail.forwarded_message') : t('mail.original_message')}
                                    </div>
                                    <div
                                        className="prose prose-sm max-w-none text-[var(--text-secondary)]"
                                        dangerouslySetInnerHTML={{ __html: quotedHtml }}
                                    />
                                </div>
                            )}

                            {/* Reply attachments */}
                            {replyAttachments.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {replyAttachments.map((f, i) => (
                                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[12px] max-w-[200px]">
                                            <FileIcon size={13} className="text-[var(--gnosi-blue)] shrink-0" />
                                            <span className="truncate text-[var(--text-primary)] font-medium">{f.name}</span>
                                            <span className="text-[var(--text-secondary)] shrink-0">{Math.round(f.size / 1024)}KB</span>
                                            <button onClick={() => setReplyAttachments(prev => prev.filter((_, j) => j !== i))} className="text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-colors shrink-0">
                                                <CloseIcon size={13} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="mt-6 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={replyFileInputRef}
                                        type="file"
                                        multiple
                                        className="hidden"
                                        onChange={e => {
                                            const files = Array.from(e.target.files || []);
                                            setReplyAttachments(prev => {
                                                const existing = new Set(prev.map(f => f.name + f.size));
                                                return [...prev, ...files.filter(f => !existing.has(f.name + f.size))];
                                            });
                                            e.target.value = '';
                                        }}
                                    />
                                    <button
                                        onClick={() => replyFileInputRef.current?.click()}
                                        className="relative p-2.5 hover:bg-[var(--bg-primary)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all border border-transparent hover:border-[var(--border-primary)]"
                                        title={t('mail.attach_reply')}
                                    >
                                        <Paperclip size={18} />
                                        {replyAttachments.length > 0 && (
                                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--gnosi-blue)] text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                                                {replyAttachments.length}
                                            </span>
                                        )}
                                    </button>
                                </div>
                                <button
                                    onClick={handleSendReply}
                                    disabled={sending || !replyBody.trim()}
                                    className="flex items-center gap-2 px-8 py-3 bg-[var(--gnosi-blue)] hover:opacity-90 disabled:opacity-50 text-white text-[15px] font-bold rounded-2xl transition-all shadow-lg active:scale-95 hover:-translate-y-0.5"
                                >
                                    {sending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                                    {t('mail.send_btn')}
                                </button>
                            </div>
                        </div>
                </div>
            </div>
        </div>

            {/* Availability overlay */}
            {showAvailability && (
                <div className="fixed inset-0 z-[var(--z-modal)] bg-[var(--bg-primary)]/40 backdrop-blur-sm flex items-center justify-center p-4 lg:p-12 animate-in fade-in duration-300">
                    <div className="bg-[var(--bg-primary)] w-full max-w-5xl h-full max-h-[800px] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-[var(--border-primary)] animate-in zoom-in-95 duration-300">
                        <div className="h-20 border-b border-[var(--border-primary)] px-8 flex items-center justify-between bg-[var(--bg-secondary)]/50">
                            <div>
                                <h3 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-[var(--gnosi-blue)] text-white flex items-center justify-center shadow-lg">
                                        <Calendar size={20} />
                                    </div>
                                    Tria la teva disponibilitat
                                </h3>
                                <p className="text-xs text-[var(--text-secondary)] font-medium ml-13 mt-1 uppercase tracking-wider">{calendarTitle}</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1 bg-[var(--bg-primary)] p-1 rounded-xl shadow-sm border border-[var(--border-primary)]">
                                    <button onClick={() => calendarCompRef.current?.getApi().prev()} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] transition-all"><ChevronLeft size={18} /></button>
                                    <button onClick={() => calendarCompRef.current?.getApi().today()} className="px-4 text-xs font-bold uppercase tracking-tight text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)]">Avui</button>
                                    <button onClick={() => calendarCompRef.current?.getApi().next()} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] transition-all"><ChevronRight size={18} /></button>
                                </div>
                                <button onClick={() => setShowAvailability(false)} className="p-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-2xl transition-all active:scale-95"><CloseIcon size={20} /></button>
                            </div>
                        </div>
                        <div className="flex-1 p-8 bg-[var(--bg-primary)] overflow-hidden">
                            <DigitalBrainCalendar
                                allNotes={calendarData.pages}
                                calendarRef={calendarCompRef}
                                onTitleChange={setCalendarTitle}
                                onSelection={handleSlotSelection}
                                selectedCalendars={new Set(calendarData.pages.map(p => p.metadata?.source).filter(Boolean))}
                                colorMap={{ 'Gnosi': 'var(--gnosi-primary)' }}
                                calendarConfigs={[]}
                            />
                        </div>
                        <div className="p-6 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)] text-center">
                            <p className="text-sm text-[var(--text-secondary)] font-medium italic">
                                Fes clic i arrossega per crear una franja de disponibilitat. Apareixerà automàticament al correu.
                            </p>
                        </div>
                    </div>
                </div>
            )}
            {/* Calendar Picker Modal */}
            {showEventCalendarPicker && (
                <div className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-[var(--bg-primary)] w-full max-w-md rounded-3xl shadow-2xl border border-[var(--border-primary)] overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)]/50">
                            <h3 className="font-bold text-[var(--text-primary)]">Tria un calendari</h3>
                            <button onClick={() => setShowEventCalendarPicker(null)} className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors">
                                <CloseIcon size={18} />
                            </button>
                        </div>
                        <div className="p-4 max-h-[300px] overflow-y-auto">
                            {availableCalendars.length === 0 ? (
                                <div className="p-8 text-center text-[var(--text-secondary)]">Carregant calendaris...</div>
                            ) : (
                                <div className="space-y-1">
                                    {availableCalendars.map(cal => (
                                        <button
                                            key={cal.id}
                                            onClick={() => handleAddExtractedEvent(showEventCalendarPicker, cal.id)}
                                            className="w-full flex items-center gap-3 p-3 hover:bg-[var(--bg-secondary)] rounded-2xl transition-all text-left group"
                                        >
                                            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: cal.backgroundColor || 'var(--gnosi-blue)' }} />
                                            <div className="flex-1">
                                                <div className="text-sm font-bold text-[var(--text-primary)]">{cal.summary}</div>
                                                <div className="text-[10px] text-[var(--text-secondary)] opacity-60 font-mono uppercase">{cal.account}</div>
                                            </div>
                                            <ChevronRight size={14} className="text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => handleAddExtractedEvent(showEventCalendarPicker, 'gnosi')}
                                        className="w-full flex items-center gap-3 p-3 hover:bg-[var(--bg-secondary)] rounded-2xl transition-all text-left group border border-dashed border-[var(--border-primary)] mt-2"
                                    >
                                        <div className="w-4 h-4 rounded-full bg-[var(--gnosi-blue)]" />
                                        <div className="flex-1">
                                            <div className="text-sm font-bold text-[var(--text-primary)]">Gnosi Vault (Local)</div>
                                            <div className="text-[10px] text-[var(--text-secondary)] opacity-60 font-mono uppercase">Local</div>
                                        </div>
                                        <ChevronRight size={14} className="text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
