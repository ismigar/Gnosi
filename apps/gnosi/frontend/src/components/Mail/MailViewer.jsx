import React, { useState, useEffect } from 'react';
import {
    Reply, ReplyAll, Forward, Trash2, MoreVertical,
    Star, Printer, Expand, Send, RefreshCw,
    Sparkles, ExternalLink, Archive, Clock, Tag, Mail, Calendar, X as CloseIcon, ChevronLeft, ChevronRight
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import { ca, enUS } from 'date-fns/locale';
import { toast } from 'react-hot-toast';
import axios from 'axios';
import MailBlockEditor from './MailBlockEditor';
import { DigitalBrainCalendar } from '../Vault/DigitalBrainCalendar';
import { useTranslation } from 'react-i18next';

export default function MailViewer({ account, mail: selectedMail }) {
    const { t, i18n } = useTranslation();
    const [mailData, setMailData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [replyBody, setReplyBody] = useState('');
    const [replyMode, setReplyMode] = useState(null); // 'reply', 'reply_all', 'forward'
    const [forwardTo, setForwardTo] = useState('');
    const [sending, setSending] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [showAvailability, setShowAvailability] = useState(false);
    const [calendarData, setCalendarData] = useState({ pages: [], integrations: {}, tables: [] });
    const [calendarTitle, setCalendarTitle] = useState('');
    const editorRef = React.useRef(null);
    const calendarCompRef = React.useRef(null);

    const dateLocale = i18n.language === 'ca' ? ca : enUS;

    useEffect(() => {
        if (!selectedMail?.id) {
            setMailData(null);
            return;
        }

        setLoading(true);
        fetch(`/api/mail/messages/${selectedMail.id}`)
            .then(res => res.json())
            .then(data => {
                setMailData(data);
                setLoading(false);
                // Si no està llegit, el marquem com a llegit
                if (!data.is_read) {
                    markAsRead(data.id);
                }
            })
            .catch(err => {
                console.error("Error fetching mail details:", err);
                setLoading(false);
            });
    }, [selectedMail]);

    const markAsRead = (id) => {
        fetch(`/api/mail/messages/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_read: true })
        }).catch(err => console.error("Error marking as read:", err));
    };

    const updateMetadata = (key, value) => {
        if (!mailData?.id) return;
        setMailData(prev => ({ ...prev, [key]: value }));

        fetch(`/api/mail/messages/${mailData.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: value })
        }).catch(err => toast.error(t('update_metadata_error')));
    };

    const handleSendReply = () => {
        if (!replyBody.trim() || !account?.email || !mailData?.id) return;
        if (replyMode === 'forward' && !forwardTo.trim()) {
            toast.error(t('recipient_required_forward'));
            return;
        }

        setSending(true);
        fetch(`/api/mail/messages/${mailData.id}/reply?email=${encodeURIComponent(account.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                body: replyBody,
                mode: replyMode || 'reply',
                to: replyMode === 'forward' ? forwardTo : null
            })
        })
            .then(res => res.json())
            .then(() => {
                setReplyBody('');
                setForwardTo('');
                setSending(false);
                setReplyMode(null);
                toast.success(t('sent_successfully'));
            })
            .catch(err => {
                console.error("Error sending reply:", err);
                setSending(false);
                toast.error(t('error_sending_reply'));
            });
    };

    const handleAIAssist = () => {
        if (!mailData?.body_text && !mailData?.snippet) return;

        setAiGenerating(true);
        const context = mailData.body_text || mailData.snippet;

        fetch('/api/mail/ai/generate_draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: context })
        })
            .then(res => res.json())
            .then(data => {
                setReplyBody(data.draft);
                setAiGenerating(false);
                toast.success(t('ai_draft_generated'));
            })
            .catch(err => {
                console.error("Error generating draft:", err);
                setAiGenerating(false);
                toast.error(t('error_generating_draft'));
            });
    };

    const fetchCalendarResources = async () => {
        try {
            const [pagesRes, integrationsRes, tablesRes] = await Promise.all([
                axios.get('/api/vault/pages'),
                axios.get('/api/integrations'),
                axios.get('/api/vault/tables'),
            ]);
            setCalendarData({
                pages: pagesRes.data,
                integrations: integrationsRes.data,
                tables: tablesRes.data
            });
        } catch (err) {
            console.error("Error fetching calendar resources:", err);
            toast.error(t('error_loading_calendar'));
        }
    };

    const handleInsertAvailability = () => {
        setShowAvailability(true);
        if (calendarData.pages.length === 0) {
            fetchCalendarResources();
        }
    };

    const handleSlotSelection = (selection) => {
        if (!editorRef.current) return;

        const { start, end, allDay } = selection;
        const startStr = format(start, allDay ? 'd MMMM' : 'd MMMM HH:mm', { locale: dateLocale });
        const endStr = end ? format(end, allDay ? 'd MMMM' : 'HH:mm', { locale: dateLocale }) : '';

        const availabilityText = allDay
            ? `${t('availability_day_prefix', { defaultValue: 'Disponible el dia' })} ${startStr}`
            : `${t('availability_range_prefix', { defaultValue: 'Disponible de' })} ${startStr} ${t('availability_range_separator', { defaultValue: 'a' })} ${endStr}`;

        // Insert as a new block in the editor
        const editor = editorRef.current;
        editor.insertBlocks(
            [{ type: "paragraph", content: availabilityText }],
            editor.getTextCursorPosition().block,
            "after"
        );

        setShowAvailability(false);
        toast.success(t('availability_inserted'));
    };

    const handleAddToVault = () => {
        toast.success(t('added_to_vault_success'));
    };

    const handleReply = () => {
        if (!mailData) return;
        setReplyMode('reply');
        setReplyBody(`\n\n--- ${t('original_message')} ---\n${t('to', { defaultValue: 'De' })}: ${mailData.sender}\n${t('date', { defaultValue: 'Data' })}: ${mailData.date}\n${t('subject', { defaultValue: 'Assumpte' })}: ${mailData.subject}\n\n${mailData.body_text || ''}`);
        setTimeout(() => document.getElementById('reply-area')?.scrollIntoView({ behavior: 'smooth' }), 100);
    };

    const handleReplyAll = () => {
        if (!mailData) return;
        setReplyMode('reply_all');
        setReplyBody(`\n\n--- ${t('original_message')} ---\n${t('to', { defaultValue: 'De' })}: ${mailData.sender}\n${t('date', { defaultValue: 'Data' })}: ${mailData.date}\n${t('subject', { defaultValue: 'Assumpte' })}: ${mailData.subject}\n\n${mailData.body_text || ''}`);
        setTimeout(() => document.getElementById('reply-area')?.scrollIntoView({ behavior: 'smooth' }), 100);
    };

    const handleForward = () => {
        if (!mailData) return;
        setReplyMode('forward');
        setReplyBody(`\n\n--- ${t('forwarded_message')} ---\n${t('to', { defaultValue: 'De' })}: ${mailData.sender}\n${t('date', { defaultValue: 'Data' })}: ${mailData.date}\n${t('subject', { defaultValue: 'Assumpte' })}: ${mailData.subject}\n\n${mailData.body_text || ''}`);
        setTimeout(() => document.getElementById('reply-area')?.scrollIntoView({ behavior: 'smooth' }), 100);
    };

    const handleToggleStar = () => {
        if (!mailData) return;
        const newValue = !mailData.is_starred;
        updateMetadata('is_starred', newValue);
        toast.success(newValue ? t('added_to_favorites') : t('removed_from_favorites'));
    };

    const handleArchive = () => {
        if (!mailData?.id || !account?.email) return;
        fetch(`/api/mail/messages/${mailData.id}/archive?email=${encodeURIComponent(account.email)}`, { method: 'POST' })
            .then(res => res.json())
            .then(() => {
                toast.success(t('mail_archived'));
            })
            .catch(err => toast.error(t('error_archiving')));
    };

    const handleDelete = () => {
        if (!mailData?.id || !account?.email) return;
        fetch(`/api/mail/messages/${mailData.id}/trash?email=${encodeURIComponent(account.email)}`, { method: 'POST' })
            .then(res => res.json())
            .then(() => {
                toast.success(t('mail_sent_to_trash'));
            })
            .catch(err => toast.error(t('error_deleting')));
    };

    if (!selectedMail) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-300 bg-white">
                <div className="w-24 h-24 rounded-3xl bg-slate-50 flex items-center justify-center mb-6 shadow-inner">
                    <Mail size={40} className="text-slate-100" />
                </div>
                <p className="text-lg font-semibold text-slate-400">{t('select_a_mail')}</p>
                <p className="text-sm text-slate-300">{t('choose_message_hint')}</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-white">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-slate-400 font-medium">{t('Loading content...')}</p>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-white overflow-hidden font-sans">
            {/* Action Bar */}
            <div className="h-16 border-b border-slate-100 px-6 flex items-center justify-between bg-white/80 backdrop-blur-xl sticky top-0 z-20">
                <div className="flex items-center gap-1.5">
                    <button onClick={handleAddToVault} title={t('add_to_vault')} className="p-2.5 hover:bg-indigo-50 rounded-xl text-slate-600 hover:text-indigo-600 transition-all flex items-center gap-2 text-sm font-medium">
                        <ExternalLink size={18} />
                        <span className="hidden lg:block">{t('add_to_vault')}</span>
                    </button>
                    <div className="w-px h-6 bg-slate-100 mx-2"></div>
                    <button onClick={handleReply} title={t('reply')} className="p-2.5 hover:bg-slate-50 rounded-xl text-slate-600 transition-all">
                        <Reply size={18} />
                    </button>
                    <button onClick={handleReplyAll} title={t('reply_all')} className="p-2.5 hover:bg-slate-50 rounded-xl text-slate-600 transition-all">
                        <ReplyAll size={18} />
                    </button>
                    <button onClick={handleForward} title={t('forward')} className="p-2.5 hover:bg-slate-50 rounded-xl text-slate-600 transition-all">
                        <Forward size={18} />
                    </button>
                    <div className="w-px h-6 bg-slate-100 mx-2"></div>
                    <button onClick={handleArchive} title={t('archive')} className="p-2.5 hover:bg-slate-50 rounded-xl text-slate-600 transition-all">
                        <Archive size={18} />
                    </button>
                    <button title={t('snooze')} className="p-2.5 hover:bg-slate-50 rounded-xl text-slate-600 transition-all">
                        <Clock size={18} />
                    </button>
                    <button onClick={handleDelete} title={t('delete')} className="p-2.5 hover:bg-slate-50 rounded-xl text-slate-600 hover:text-red-500 transition-all">
                        <Trash2 size={18} />
                    </button>
                </div>

                <div className="flex items-center gap-1.5">
                    <button
                        onClick={handleToggleStar}
                        className={`p-2.5 rounded-xl transition-all ${mailData?.is_starred ? 'text-amber-500 bg-amber-50' : 'text-slate-600 hover:bg-slate-50'}`}
                        title={mailData?.is_starred ? t('removed_from_favorites') : t('added_to_favorites')}
                    >
                        <Star size={18} fill={mailData?.is_starred ? "currentColor" : "none"} />
                    </button>
                    <button className="p-2.5 hover:bg-slate-50 rounded-xl text-slate-600 transition-all">
                        <MoreVertical size={18} />
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                <div className="max-w-[700px] mx-auto py-12 px-8 space-y-10">
                    <div>
                        <h1 className="text-3xl font-extrabold text-slate-900 leading-tight mb-8 tracking-tight">
                            {mailData?.subject}
                        </h1>

                        <div className="flex items-center justify-between mb-10 pb-10 border-b border-slate-50">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-200">
                                    {mailData?.sender?.[0]?.toUpperCase()}
                                </div>
                                <div>
                                    <div className="font-bold text-slate-900 text-lg leading-tight">
                                        {mailData?.sender?.split('<')[0].trim()}
                                    </div>
                                    <div className="text-xs text-slate-400 font-medium">
                                        {t('to')}: {mailData?.recipient}
                                        {mailData?.cc && <span className="block italic mt-0.5">CC: {mailData.cc}</span>}
                                        {mailData?.bcc && <span className="block italic mt-0.5">BCC: {mailData.bcc}</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-sm font-bold text-slate-900">
                                    {mailData?.timestamp ? format(new Date(mailData.timestamp * 1000), 'd MMM yyyy', { locale: dateLocale }) : ''}
                                </div>
                                <div className="text-xs text-slate-400 font-medium tracking-wide uppercase">
                                    {mailData?.timestamp ? format(new Date(mailData.timestamp * 1000), 'HH:mm') : ''}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Meta Section */}
                    <div className="flex flex-wrap gap-4 items-center">
                        <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                            <Tag size={14} className="text-slate-400" />
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{mailData?.category || t('general')}</span>
                        </div>
                        <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100/50">
                            <div className="w-2 h-2 rounded-full bg-indigo-500" />
                            <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Inbox</span>
                        </div>
                    </div>

                    {/* Email Body */}
                    <div className="prose prose-indigo max-w-none min-h-[400px]">
                        {mailData?.body_html ? (
                            <div
                                className="mail-body-html text-slate-800 leading-relaxed text-[15px]"
                                dangerouslySetInnerHTML={{ __html: mailData.body_html }}
                            />
                        ) : (
                            <div className="text-slate-800 leading-relaxed whitespace-pre-wrap text-[15px]">
                                {mailData?.body_text || mailData?.snippet}
                            </div>
                        )}
                    </div>

                    {/* Reply Section */}
                    <div className="pt-20 pb-10" id="reply-area">
                        <div className="bg-[#fbfcff] rounded-3xl border-2 border-indigo-50/50 p-6 shadow-sm shadow-indigo-50/20">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                                        {replyMode === 'forward' ? <Forward size={16} /> : replyMode === 'reply_all' ? <ReplyAll size={16} /> : <Reply size={16} />}
                                    </div>
                                    <h3 className="font-bold text-slate-800">
                                        {replyMode === 'forward' ? t('forward') : replyMode === 'reply_all' ? t('reply_all') : t('quick_reply')}
                                    </h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleInsertAvailability}
                                        className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 text-slate-600 border border-slate-100 rounded-xl text-sm font-bold transition-all hover:shadow-md active:scale-95"
                                    >
                                        <Calendar size={14} />
                                        {t('availability')}
                                    </button>
                                    <button
                                        onClick={handleAIAssist}
                                        disabled={aiGenerating}
                                        className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl text-sm font-bold transition-all hover:shadow-md hover:shadow-indigo-50 active:scale-95 disabled:opacity-50"
                                    >
                                        {aiGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                        {t('ai_assist')}
                                    </button>
                                </div>
                            </div>

                            {replyMode === 'forward' && (
                                <div className="mb-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2 ml-1">{t('to')}:</label>
                                    <input
                                        type="email"
                                        placeholder="correu@exemple.com"
                                        className="w-full bg-white border border-slate-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-200 transition-all font-medium text-slate-700"
                                        value={forwardTo}
                                        onChange={(e) => setForwardTo(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                            )}

                            <MailBlockEditor
                                initialContent={replyBody}
                                onChange={setReplyBody}
                                editorRef={editorRef}
                            />

                            <div className="mt-6 flex justify-end">
                                <button
                                    onClick={handleSendReply}
                                    disabled={sending || !replyBody.trim()}
                                    className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[15px] font-bold rounded-2xl transition-all shadow-lg shadow-indigo-100 hover:shadow-indigo-200 active:scale-95 translate-y-0 hover:-translate-y-0.5"
                                >
                                    {sending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                                    {t('send_mail')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Availability Selection Overlay */}
            {showAvailability && (
                <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 lg:p-12 animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-5xl h-full max-h-[800px] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300">
                        {/* Header */}
                        <div className="h-20 border-b border-slate-100 px-8 flex items-center justify-between bg-slate-50/50">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-100">
                                        <Calendar size={20} />
                                    </div>
                                    {t('choose_availability_title')}
                                </h3>
                                <p className="text-xs text-slate-400 font-medium ml-13 mt-1 uppercase tracking-wider">{calendarTitle}</p>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1 bg-white p-1 rounded-xl shadow-sm border border-slate-100">
                                    <button
                                        onClick={() => calendarCompRef.current?.getApi().prev()}
                                        className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-indigo-600 transition-all"
                                    >
                                        <ChevronLeft size={18} />
                                    </button>
                                    <button
                                        onClick={() => calendarCompRef.current?.getApi().today()}
                                        className="px-4 text-xs font-bold uppercase tracking-tight text-slate-500 hover:text-indigo-600"
                                    >
                                        {t('today_btn')}
                                    </button>
                                    <button
                                        onClick={() => calendarCompRef.current?.getApi().next()}
                                        className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-indigo-600 transition-all"
                                    >
                                        <ChevronRight size={18} />
                                    </button>
                                </div>
                                <button
                                    onClick={() => setShowAvailability(false)}
                                    className="p-3 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 rounded-2xl transition-all active:scale-95"
                                >
                                    <CloseIcon size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Calendar Body */}
                        <div className="flex-1 p-8 bg-white overflow-hidden">
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

                        {/* Footer Tips */}
                        <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
                            <p className="text-sm text-slate-400 font-medium italic">
                                {t('availability_hint')}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
