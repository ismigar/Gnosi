import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Send, X, Paperclip, Sparkles, RefreshCw, ChevronDown, File as FileIcon,
    Calendar, ChevronLeft, ChevronRight, Trash2, Type, Reply, ReplyAll, Forward
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { ca } from 'date-fns/locale';
import axios from 'axios';
import MailBlockEditor from './MailBlockEditor';
import { AddressInput } from './MailAddressInput';
import { DigitalBrainCalendar } from '../Vault/DigitalBrainCalendar';

// ─── AttachmentBadge ──────────────────────────────────────────────────────────
function AttachmentBadge({ file, onRemove }) {
    const sizeKB = Math.round(file.size / 1024);
    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[12px] max-w-[200px]">
            <FileIcon size={13} className="text-[var(--gnosi-blue)] shrink-0" />
            <span className="truncate text-[var(--text-primary)] font-medium">{file.name}</span>
            <span className="text-[var(--text-secondary)] shrink-0">{sizeKB}KB</span>
            <button type="button" onClick={() => onRemove(file)} className="text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-colors shrink-0">
                <X size={13} />
            </button>
        </div>
    );
}

// ─── MailComposer ─────────────────────────────────────────────────────────────
export default function MailComposer({
    account, accounts = [], onClose, onSent, onDraftSaved,
    mode = null, replyToMessageId = null,
    initialTo = '', initialCc = '', initialSubject = '', quotedHtml = '',
    initialBody = '', _draftId = null,
}) {
    const { t } = useTranslation();
    const [fromAccount, setFromAccount] = useState(account || accounts[0] || null);
    useEffect(() => {
        if (account && !fromAccount) setFromAccount(account);
    }, [account]);
    const [to, setTo] = useState(initialTo);
    const [cc, setCc] = useState(initialCc);
    const [bcc, setBcc] = useState('');
    const [showCcBcc, setShowCcBcc] = useState(!!initialCc);
    const [subject, setSubject] = useState(initialSubject);
    const [body, setBody] = useState('');
    // Signatura reactiva: s'actualitza quan canvia la identitat "De"
    const signatureHtml = useMemo(
        () => fromAccount?.signature || '',
        [fromAccount]
    );
    const isReplyOrForward = mode === 'reply' || mode === 'reply_all' || mode === 'forward';

    // Respostes/reenviaments: cursor dalt → línia buida → signatura → citat
    const editorInitialHtml = useMemo(() => {
        if (initialBody) return initialBody;
        if (!quotedHtml) return '';
        const sigBlock = signatureHtml
            ? `<div style="margin-bottom:0.5rem">${signatureHtml}</div><hr style="border:none;border-top:1px solid #ccc;margin:0.5rem 0">`
            : '';
        return `${sigBlock}<blockquote style="border-left:3px solid #6366f1;padding-left:0.75rem;color:#888;margin-top:1rem">${quotedHtml}</blockquote>`;
    }, [quotedHtml, signatureHtml]);
    const [attachments, setAttachments] = useState([]);
    const [sending, setSending] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [showAvailability, setShowAvailability] = useState(false);
    const [showSnippets, setShowSnippets] = useState(false);
    const [calendarData, setCalendarData] = useState({ pages: [], integrations: {}, tables: [] });
    const [calendarTitle, setCalendarTitle] = useState('');
    const editorRef = React.useRef(null);
    const draftIdRef = useRef(_draftId);
    const fileInputRef = useRef(null);
    const calendarCompRef = useRef(null);

    const [showCloseConfirm, setShowCloseConfirm] = useState(false);

    const bodyRef = useRef(body);
    const subjectRef = useRef(subject);
    const toRef = useRef(to);
    const ccRef = useRef(cc);
    const bccRef = useRef(bcc);
    useEffect(() => { bodyRef.current = body; }, [body]);
    useEffect(() => { subjectRef.current = subject; }, [subject]);
    useEffect(() => { toRef.current = to; }, [to]);
    useEffect(() => { ccRef.current = cc; }, [cc]);
    useEffect(() => { bccRef.current = bcc; }, [bcc]);

    const saveDraft = useCallback(async () => {
        if (!fromAccount?.email) return;
        const currentBody = bodyRef.current;
        const currentSubject = subjectRef.current;
        const bodyText = currentBody?.replace(/<[^>]*>/g, '').trim() || '';
        if (!bodyText && !currentSubject) return;
        try {
            const res = await fetch('/api/mail/drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    draft_id: draftIdRef.current || undefined,
                    to: toRef.current,
                    cc: ccRef.current,
                    bcc: bccRef.current,
                    subject: currentSubject,
                    body: currentBody,
                    account: fromAccount.email,
                }),
            });
            // Sense aquest check, una resposta 5xx (servidor caigut, base de
            // dades de drafts plena) feia que res.json() retornés el body
            // d'error i tot continués com si res, deixant l'usuari amb la
            // sensació que els drafts es guardaven cada 2s quan cap ho feia.
            if (!res.ok) throw new Error(`Draft save HTTP ${res.status}`);
            const data = await res.json();
            const isFirstSave = !draftIdRef.current;
            if (data.draft_id) draftIdRef.current = data.draft_id;
            if (isFirstSave) {
                toast(t('mail.draft_saved'), { icon: '💾', duration: 1500 });
                onDraftSaved?.();
            }
        } catch (err) {
            // Auto-save no notifica l'usuari (massa intrusiu cada 2s) però
            // logueja perquè no es perdi la causa real.
            console.warn('[MailComposer] draft auto-save failed:', err);
        }
    }, [fromAccount, t]);

    const hasContent = useCallback(() => {
        const bodyText = bodyRef.current?.replace(/<[^>]*>/g, '').trim() || '';
        return !!(bodyText || subjectRef.current?.trim() || toRef.current?.trim());
    }, []);

    const handleCloseRequest = useCallback(() => {
        if (hasContent()) {
            setShowCloseConfirm(true);
        } else {
            onClose();
        }
    }, [hasContent, onClose]);

    const handleSaveAndClose = useCallback(async () => {
        await saveDraft();
        setShowCloseConfirm(false);
        onClose();
    }, [saveDraft, onClose]);

    // Auto-save cada 2s mentre hi ha contingut
    useEffect(() => {
        if (!fromAccount?.email) return;
        const timer = setInterval(saveDraft, 2000);
        return () => clearInterval(timer);
    }, [fromAccount, saveDraft]);

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files || []);
        setAttachments(prev => {
            const existing = new Set(prev.map(f => f.name + f.size));
            return [...prev, ...files.filter(f => !existing.has(f.name + f.size))];
        });
        // reset so same file can be re-added after removal
        e.target.value = '';
    };

    const removeAttachment = (file) => {
        setAttachments(prev => prev.filter(f => f !== file));
    };

    const handleSend = async () => {
        if (!to.trim() || !body.trim() || !fromAccount?.email) {
            toast.error(t('mail.compose_missing_fields'));
            return;
        }
        setSending(true);
        try {
            const sigPart = (!isReplyOrForward && signatureHtml) ? `<div style="margin-top:1rem">${signatureHtml}</div>` : '';
            const fullBody = body + sigPart;
            const smtpEmail = fromAccount.smtp_email || fromAccount.email;
            const fromAddr = fromAccount.smtp_email ? fromAccount.email : null;
            const fromDisplayName = fromAccount.display_name || fromAccount.name || null;

            const formData = new FormData();
            formData.append('to', to);
            formData.append('subject', subject);
            formData.append('body', fullBody);
            if (cc) formData.append('cc', cc);
            if (bcc) formData.append('bcc', bcc);
            if (fromAddr) formData.append('from_email', fromAddr);
            if (fromDisplayName) formData.append('from_name', fromDisplayName);
            attachments.forEach(f => formData.append('attachments', f));

            let res;
            if (mode && replyToMessageId) {
                res = await fetch(
                    `/api/mail/messages/${replyToMessageId}/reply?email=${encodeURIComponent(smtpEmail)}`,
                    { method: 'POST', body: formData }
                );
            } else {
                res = await fetch(`/api/mail/send?email=${encodeURIComponent(smtpEmail)}`, {
                    method: 'POST',
                    body: formData,
                });
            }
            const data = await res.json();
            if (data.status === 'success' || data.message_id) {
                if (draftIdRef.current) {
                    fetch(`/api/mail/drafts/${draftIdRef.current}`, { method: 'DELETE' }).catch(() => {});
                    onDraftSaved?.();
                }
                toast.success(t('mail.sent_ok'));
                try { editorRef.current?.replaceBlocks([{ type: 'paragraph', content: '' }]); } catch { /* ok */ }
                if (onSent) onSent();
                onClose();
            } else {
                toast.error(t('mail.send_error'));
            }
        } catch {
            toast.error(t('mail.send_error'));
        } finally {
            setSending(false);
        }
    };

    const fetchCalendarResources = useCallback(async () => {
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
    }, []);

    const handleInsertAvailability = () => {
        setShowAvailability(true);
        if (calendarData.pages.length === 0) fetchCalendarResources();
    };

    useEffect(() => {
        const handler = (e) => {
            if (e.key !== 'Escape') return;
            if (showAvailability) { setShowAvailability(false); return; }
            if (showCloseConfirm) { setShowCloseConfirm(false); return; }
            handleCloseRequest();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [showAvailability, showCloseConfirm, handleCloseRequest]);

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

    const SNIPPETS = (() => {
        try {
            const stored = JSON.parse(localStorage.getItem('gnosi_mail_snippets') || 'null');
            if (stored) return stored.map(s => ({ key: s.id, label: s.title, content: s.content }));
        } catch { /* ok */ }
        return [
            { key: 'snip_default_1', label: 'Salutació formal',        content: 'Benvolgut/da,\n\nEspero que es trobi bé.' },
            { key: 'snip_default_2', label: 'Gràcies per la resposta', content: 'Moltes gràcies per la seva resposta.' },
            { key: 'snip_default_3', label: 'Comiat formal',           content: 'Atentament,\n\n' },
            { key: 'snip_default_4', label: 'Proposta reunió',         content: 'Li proposo una reunió per tractar aquest tema.' },
            { key: 'snip_default_5', label: 'Seguiment',               content: 'Em poso en contacte per fer seguiment del tema anterior.' },
        ];
    })();

    const handleInsertSnippet = (text) => {
        const editor = editorRef.current;
        if (editor?.insertBlocks) {
            editor.insertBlocks([{ type: 'paragraph', content: text }], editor.getTextCursorPosition().block, 'after');
        }
        setShowSnippets(false);
    };

    const handleAIAssist = async () => {
        if (!subject && !body) {
            toast.error(t('mail.ai_needs_context'));
            return;
        }
        setAiGenerating(true);
        try {
            const res = await fetch('/api/mail/ai/generate_draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: body, prompt: `Create a professional draft about: ${subject}` }),
            });
            const data = await res.json();
            setBody(data.draft);
            toast.success(t('mail.ai_draft_ok'));
        } catch {
            toast.error(t('mail.ai_draft_error'));
        } finally {
            setAiGenerating(false);
        }
    };

    const modeIcon = mode === 'reply' ? <Reply size={16} /> : mode === 'reply_all' ? <ReplyAll size={16} /> : mode === 'forward' ? <Forward size={16} /> : <Send size={16} />;
    const modeLabel = mode === 'reply' ? t('mail.reply_title') : mode === 'reply_all' ? t('mail.reply_all_title') : mode === 'forward' ? t('mail.forward_title') : t('mail.new_message');

    return (
        <div
            className="flex flex-col h-full bg-[var(--bg-primary)] relative animate-in slide-in-from-right-4 duration-300"
            onKeyDown={e => {
                // Cmd+Enter → enviar; Shift+Enter → hard break gestionat per BlockNote
                // En ambdós casos evitem el comportament per defecte del browser (submit/refresh)
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSend();
                } else if (e.shiftKey && e.key === 'Enter') {
                    // BlockNote ja gestiona Shift+Enter internament; aquí només evitem
                    // que el browser faci res per defecte si l'event burbulla fora de l'editor
                    e.stopPropagation();
                }
            }}
        >
            {/* Header */}
            <div className="h-16 border-b border-[var(--border-primary)] px-6 flex items-center justify-between sticky top-0 z-20 bg-[var(--bg-primary)]/80 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-[var(--gnosi-blue)] text-white flex items-center justify-center">
                        {modeIcon}
                    </div>
                    <h2 className="font-bold text-[var(--text-primary)]">{modeLabel}</h2>
                </div>
                <button type="button" onClick={handleCloseRequest} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all">
                    <X size={20} />
                </button>
            </div>

            {/* Address fields */}
            <div className="flex-1 overflow-y-auto p-8 space-y-0">
                <div className="max-w-[800px] mx-auto">
                    {/* From */}
                    <div className="flex items-center border-b border-[var(--border-primary)] py-2">
                        <span className="text-[13px] font-bold text-[var(--text-secondary)] uppercase w-20 shrink-0">
                            {t('mail.from_label')}:
                        </span>
                        <select
                            value={fromAccount?.email || fromAccount?.username || ''}
                            onChange={e => {
                                const acc = accounts.find(a => (a.email || a.username) === e.target.value);
                                if (acc) setFromAccount(acc);
                            }}
                            className="flex-1 bg-transparent border-none text-[15px] focus:ring-0 font-medium text-[var(--text-primary)] outline-none cursor-pointer appearance-none"
                        >
                            {accounts.map(acc => {
                                const email = acc.email || acc.username;
                                const label = acc.name ? `${acc.name} <${email}>` : email;
                                return <option key={email} value={email}>{label}</option>;
                            })}
                            {accounts.length === 0 && fromAccount && (
                                <option value={fromAccount.email || fromAccount.username}>
                                    {fromAccount.email || fromAccount.username}
                                </option>
                            )}
                        </select>
                        <ChevronDown size={14} className="text-[var(--text-secondary)] shrink-0 pointer-events-none" />
                    </div>

                    <AddressInput
                        label={t('mail.to_label')}
                        placeholder="exemple@correu.com"
                        value={to}
                        onChange={setTo}
                        accountEmail={account?.email}
                    />

                    {/* Subject + CC/BCC toggle */}
                    <div className="flex items-center border-b border-[var(--border-primary)] py-2">
                        <span className="text-[13px] font-bold text-[var(--text-secondary)] uppercase w-20 shrink-0">
                            {t('mail.subject_label')}:
                        </span>
                        <input
                            type="text"
                            className="flex-1 bg-transparent border-none text-[15px] focus:ring-0 placeholder:text-[var(--text-secondary)] font-bold text-[var(--text-primary)] outline-none"
                            placeholder={t('mail.subject_placeholder')}
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowCcBcc(v => !v)}
                            className="flex items-center gap-1 text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] transition-colors ml-2 shrink-0"
                        >
                            CC/CCO
                            <ChevronDown size={13} className={`transition-transform ${showCcBcc ? 'rotate-180' : ''}`} />
                        </button>
                    </div>

                    {showCcBcc && (
                        <div className="animate-in slide-in-from-top-1 duration-200">
                            <AddressInput
                                label="CC"
                                placeholder="cc@exemple.com"
                                value={cc}
                                onChange={setCc}
                                accountEmail={account?.email}
                            />
                            <AddressInput
                                label="CCO"
                                placeholder="cco@exemple.com"
                                value={bcc}
                                onChange={setBcc}
                                accountEmail={account?.email}
                            />
                        </div>
                    )}

                    {/* Editor */}
                    <div className="pt-6 min-h-[200px]">
                        <MailBlockEditor
                            initialContent={editorInitialHtml}
                            prependEmptyLines={quotedHtml ? 2 : 0}
                            onChange={setBody}
                            editorRef={editorRef}
                            autoFocus
                            onAttachFile={file => setAttachments(prev => {
                                if (prev.some(f => f.name === file.name && f.size === file.size)) return prev;
                                return [...prev, file];
                            })}
                        />
                    </div>

                    {/* Signatura fora de l'editor només per missatges nous (en replies ja va dins) */}
                    {!isReplyOrForward && signatureHtml && (
                        <div className="mt-3 pt-3 border-t border-[var(--border-primary)]">
                            <div
                                className="text-[var(--text-secondary)] text-[13px] leading-relaxed [&_a]:text-[var(--gnosi-blue)]"
                                dangerouslySetInnerHTML={{ __html: signatureHtml }}
                            />
                        </div>
                    )}

                    {/* Attachment list */}
                    {attachments.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2 animate-in slide-in-from-bottom-2 duration-200">
                            {attachments.map((f, i) => (
                                <AttachmentBadge key={i} file={f} onRemove={removeAttachment} />
                            ))}
                        </div>
                    )}

                </div>
            </div>

            {/* Footer Toolbar */}
            <div className="px-6 py-4 border-t border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)]/50">
                <div className="flex items-center gap-2">
                    {/* IA Assist */}
                    <button
                        type="button"
                        onClick={handleAIAssist}
                        disabled={aiGenerating}
                        className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-primary)] hover:bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] border border-[var(--border-primary)] rounded-xl text-sm font-bold transition-all shadow-sm"
                    >
                        {aiGenerating ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
                        {t('mail.ai_draft')}
                    </button>

                    {/* Adjuntar arxiu */}
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="relative p-2.5 hover:bg-[var(--bg-primary)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all border border-transparent hover:border-[var(--border-primary)]"
                        title={t('mail.attach_file')}
                    >
                        <Paperclip size={18} />
                        {attachments.length > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--gnosi-blue)] text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                                {attachments.length}
                            </span>
                        )}
                    </button>

                    {/* Insertar fragment */}
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setShowSnippets(v => !v)}
                            className="p-2.5 hover:bg-[var(--bg-primary)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all border border-transparent hover:border-[var(--border-primary)]"
                            title={t('mail.insert_snippet')}
                        >
                            <Type size={18} />
                        </button>
                        {showSnippets && (
                            <>
                                <div className="fixed inset-0 z-[var(--z-overlay)]" onClick={() => setShowSnippets(false)} />
                                <div className="absolute bottom-full mb-2 left-0 z-[var(--z-modal)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl py-1 w-64 animate-in fade-in zoom-in-95 duration-150">
                                    <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('mail.insert_snippet')}</div>
                                    {SNIPPETS.map(s => (
                                        <button
                                            type="button"
                                            key={s.key}
                                            onMouseDown={() => handleInsertSnippet(s.content || s.label)}
                                            className="w-full text-left px-4 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                        >
                                            <span className="font-semibold truncate block">{s.label}</span>
                                            {s.content && s.content !== s.label && (
                                                <span className="text-[11px] text-[var(--text-secondary)] truncate block opacity-70">{s.content.substring(0, 50)}{s.content.length > 50 ? '…' : ''}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Insertar disponibilitat */}
                    <button
                        type="button"
                        onClick={handleInsertAvailability}
                        className="p-2.5 hover:bg-[var(--bg-primary)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all border border-transparent hover:border-[var(--border-primary)]"
                        title={t('mail.availability')}
                    >
                        <Calendar size={18} />
                    </button>

                    {/* Eliminar / descartar */}
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2.5 hover:bg-[var(--bg-primary)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-all border border-transparent hover:border-[var(--border-primary)]"
                        title={t('mail.discard_draft')}
                    >
                        <Trash2 size={18} />
                    </button>
                </div>

                <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending}
                    className="flex items-center gap-2 px-8 py-3 bg-[var(--gnosi-blue)] hover:opacity-90 text-white rounded-2xl font-bold shadow-lg transition-all active:scale-95 disabled:opacity-50"
                >
                    {sending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                    {t('mail.send_btn')}
                </button>
            </div>

            {/* Close confirmation dialog */}
            {showCloseConfirm && (
                <div className="fixed inset-0 z-[var(--z-modal)] bg-black/30 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-150">
                    <div className="bg-[var(--bg-primary)] rounded-2xl shadow-2xl border border-[var(--border-primary)] p-6 w-[340px] animate-in zoom-in-95 duration-150">
                        <h3 className="font-bold text-[var(--text-primary)] text-[16px] mb-1">{t('mail.close_confirm_title')}</h3>
                        <p className="text-[13px] text-[var(--text-secondary)] mb-5">{t('mail.close_confirm_desc')}</p>
                        <div className="flex flex-col gap-2">
                            <button
                                type="button"
                                onClick={handleSaveAndClose}
                                className="w-full px-4 py-2.5 bg-[var(--gnosi-blue)] text-white rounded-xl font-bold text-[14px] hover:opacity-90 transition-all"
                            >
                                {t('mail.close_save_draft')}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowCloseConfirm(false); onClose(); }}
                                className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] text-[var(--status-error)] rounded-xl font-semibold text-[14px] hover:bg-[var(--bg-tertiary)] transition-all"
                            >
                                {t('mail.close_discard')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowCloseConfirm(false)}
                                className="w-full px-4 py-2.5 text-[var(--text-secondary)] rounded-xl font-semibold text-[14px] hover:bg-[var(--bg-secondary)] transition-all"
                            >
                                {t('mail.close_cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Availability overlay */}
            {showAvailability && (
                <div className="fixed inset-0 z-[var(--z-modal)] bg-[var(--bg-primary)]/40 backdrop-blur-sm flex items-center justify-center p-4 lg:p-12 animate-in fade-in duration-300">
                    <div className="bg-[var(--bg-primary)] w-full max-w-5xl h-full max-h-[800px] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-[var(--border-primary)] animate-in zoom-in-95 duration-300">
                        <div className="h-20 border-b border-[var(--border-primary)] px-8 flex items-center justify-between bg-[var(--bg-secondary)]/50">
                            <h3 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-[var(--gnosi-blue)] text-white flex items-center justify-center shadow-lg">
                                    <Calendar size={20} />
                                </div>
                                Tria la teva disponibilitat
                            </h3>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1 bg-[var(--bg-primary)] p-1 rounded-xl shadow-sm border border-[var(--border-primary)]">
                                    <button type="button" onClick={() => calendarCompRef.current?.getApi().prev()} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] transition-all"><ChevronLeft size={18} /></button>
                                    <button type="button" onClick={() => calendarCompRef.current?.getApi().today()} className="px-4 text-xs font-bold uppercase tracking-tight text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)]">Avui</button>
                                    <button type="button" onClick={() => calendarCompRef.current?.getApi().next()} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] transition-all"><ChevronRight size={18} /></button>
                                </div>
                                <button type="button" onClick={() => setShowAvailability(false)} className="p-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-2xl transition-all active:scale-95"><X size={20} /></button>
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
        </div>
    );
}
