import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
    Reply, ReplyAll, Forward, Trash2,
    Star, RefreshCw, Sparkles, ExternalLink,
    Archive, Clock, Tag, Mail, FolderInput,
    X as CloseIcon, ChevronDown,
    FileText, UserPlus, CalendarCheck,
    MapPin, Phone, Building, ShieldAlert, Maximize2, Minimize2,
    Paperclip, File as FileIcon, ChevronRight,
} from 'lucide-react';
import { format, addHours, addDays, nextMonday } from 'date-fns';
import { ca } from 'date-fns/locale';
import { toast } from '../../lib/toast';
import MailTagPicker, { TagPill } from './MailTagPicker';
import { useMailTags } from '../../hooks/useMailTags';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import axios from 'axios';
import { Document, Page, pdfjs } from 'react-pdf';
import { translateFolderName } from './mailFolderUtils';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

const cleanName = (addr) =>
    (addr || '').split('<')[0].trim().replace(/^["']+|["']+$/g, '').trim() || addr || '';

function sanitizeHtml(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
}

// Escape values interpolated into HTML we build ourselves (e.g. the quoted-reply
// header). The sender/subject are attacker-controlled: `Name <a@b.com>` would be
// parsed as a tag (losing the address), and a crafted value could inject markup
// into the outgoing reply.
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Emails are embedded inside a sandboxed iframe. By default we force a
// white canvas + dark text (same as Gmail/Apple Mail/Outlook): commercial
// emails expect a light background for their designs, so plain-text emails
// remain readable in dark mode too (otherwise: `#111` text on the background
// dark inherited from the wrapper = invisible).
//
// The user can enable the "Read emails in dark mode" toggle in Settings
// → Appearance, which is persisted in `localStorage.gnosi_mail_dark_body`. When
// it's active we apply a dark palette to the email body (some emails with
// inline styles may suffer from low contrast — it's a known trade-off).
const EMAIL_CSS_LIGHT = `
    html, body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; line-height: 1.6; color: #111; background: #fff; }
    img { max-width: 100% !important; height: auto !important; display: inline-block; }
    table { max-width: 100% !important; border-collapse: collapse; }
    td, th { word-break: break-word; }
    pre, code { white-space: pre-wrap; word-break: break-word; }
    a { color: #3b82f6; }
    * { box-sizing: border-box; }
`;
const EMAIL_CSS_DARK = `
    html, body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; line-height: 1.6; color: #e6e6e6; background: #1a1a1a; }
    img { max-width: 100% !important; height: auto !important; display: inline-block; }
    table { max-width: 100% !important; border-collapse: collapse; }
    td, th { word-break: break-word; color: inherit; }
    pre, code { white-space: pre-wrap; word-break: break-word; background: #2a2a2a; color: #e6e6e6; }
    a { color: #6ea8fe; }
    blockquote { border-left: 3px solid #444; color: #c0c0c0; }
    hr { border-color: #444; }
    * { box-sizing: border-box; }
`;
const MAIL_DARK_BODY_KEY = 'gnosi_mail_dark_body';
const MAIL_DARK_BODY_EVENT = 'gnosi-mail-dark-body-changed';
function readMailDarkBody() {
    try { return localStorage.getItem(MAIL_DARK_BODY_KEY) === '1'; } catch { return false; }
}

const PDF_ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

function PdfViewer({ url }) {
    const { t } = useTranslation();
    const [numPages, setNumPages] = useState(null);
    const [zoom, setZoom] = useState('fit');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef(null);
    const scrollRef = useRef(null);
    const hoveredRef = useRef(false);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        if (!containerRef.current) return;
        const obs = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width));
        obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, [isFullscreen]);

    const pageWidth = containerWidth
        ? (zoom === 'fit' ? containerWidth : containerWidth * zoom)
        : undefined;

    const zoomLabel = zoom === 'fit' ? t('mail.pdf_fit_width', "Fit width") : `${Math.round(zoom * 100)}%`;
    const zoomIn  = () => setZoom(z => { const s = typeof z === 'number' ? z : 1; return PDF_ZOOM_STEPS.find(v => v > s) ?? s; });
    const zoomOut = () => setZoom(z => { const s = typeof z === 'number' ? z : 1; const p = [...PDF_ZOOM_STEPS].reverse().find(v => v < s); return p ?? 'fit'; });
    const atMax = typeof zoom === 'number' && zoom >= PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1];
    const atMin = zoom === 'fit';

    useEffect(() => {
        const onKey = (e) => {
            if (e.metaKey || e.ctrlKey) {
                if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
                if (e.key === '-') { e.preventDefault(); zoomOut(); }
                if (e.key === '0') { e.preventDefault(); setZoom('fit'); }
            }
            if (e.key === 'Escape' && isFullscreen) { setIsFullscreen(false); return; }

            // Scroll the PDF when the cursor is over it
            if (!hoveredRef.current) return;
            const el = scrollRef.current;
            if (!el) return;
            const step = 80;
            if (e.key === 'ArrowDown') { e.preventDefault(); el.scrollBy(0, step); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); el.scrollBy(0, -step); }
            else if (e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); el.scrollBy(0, el.clientHeight * 0.9); }
            else if (e.key === 'PageUp') { e.preventDefault(); el.scrollBy(0, -el.clientHeight * 0.9); }
            else if (e.key === 'Home') { e.preventDefault(); el.scrollTo(0, 0); }
            else if (e.key === 'End') { e.preventDefault(); el.scrollTo(0, el.scrollHeight); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [zoom, isFullscreen]);

    const pdfContent = (maxH) => (
        <div
            ref={el => { containerRef.current = el; scrollRef.current = el; }}
            className="overflow-auto"
            style={{ maxHeight: maxH }}
            onMouseEnter={() => { hoveredRef.current = true; }}
            onMouseLeave={() => { hoveredRef.current = false; }}
        >
            {containerWidth > 0 && (
                <Document
                    file={url}
                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                    loading={
                        <div className="flex items-center justify-center py-16">
                            <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        </div>
                    }
                    error={<div className="p-8 text-center text-red-400 text-sm">{t('mail.pdf_load_error', "Couldn't load the PDF")}</div>}
                >
                    {numPages && Array.from({ length: numPages }, (_, i) => (
                        <div key={i} className="flex justify-center py-2">
                            <Page
                                pageNumber={i + 1}
                                width={pageWidth}
                                renderTextLayer={true}
                                renderAnnotationLayer={true}
                            />
                        </div>
                    ))}
                </Document>
            )}
        </div>
    );

    const toolbar = (onFullscreenToggle, fullscreen) => (
        <div className="flex items-center gap-2 px-3 py-2" style={{ background: '#3c3f41', borderBottom: '1px solid #222' }}>
            <button onClick={zoomOut} disabled={atMin}
                className="w-7 h-7 flex items-center justify-center rounded text-white text-lg font-bold hover:bg-white/10 disabled:opacity-30 transition-all">−</button>
            <span className="text-[12px] font-bold text-white/80 min-w-[56px] text-center select-none">{zoomLabel}</span>
            <button onClick={zoomIn} disabled={atMax}
                className="w-7 h-7 flex items-center justify-center rounded text-white text-lg font-bold hover:bg-white/10 disabled:opacity-30 transition-all">+</button>
            <button onClick={() => setZoom('fit')}
                className="ml-1 px-2 py-1 rounded text-[11px] font-bold text-white/60 hover:bg-white/10 transition-all">
                {t('mail.pdf_fit_width', "Fit width")}
            </button>
            <span className="ml-auto text-[10px] text-white/30 mr-2">⌘+/−/0</span>
            <button
                onClick={onFullscreenToggle}
                title={fullscreen ? t('mail.pdf_exit_fullscreen', "Exit fullscreen (Esc)") : t('mail.pdf_fullscreen', "Fullscreen")}
                className="w-7 h-7 flex items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition-all"
            >
                {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
        </div>
    );

    if (isFullscreen) {
        return (
            <div className="fixed inset-0 z-[var(--z-modal)] flex flex-col" style={{ background: '#525659' }}>
                {toolbar(() => setIsFullscreen(false), true)}
                {pdfContent('calc(100vh - 41px)')}
            </div>
        );
    }

    return (
        <div className="w-full rounded-xl border border-[var(--border-primary)] overflow-hidden" style={{ background: '#525659' }}>
            {toolbar(() => setIsFullscreen(true), false)}
            {pdfContent('75vh')}
        </div>
    );
}

function AttachmentList({ attachments, messageId, email, folder }) {
    const { t } = useTranslation();
    const [previewIndex, setPreviewIndex] = useState(null);

    const attUrl = (att, { forInline = false } = {}) => {
        const id = att.attachment_id ?? att.part_index;
        let url = `/api/mail/messages/${messageId}/attachments/${encodeURIComponent(id)}?email=${encodeURIComponent(email)}&folder=${encodeURIComponent(folder || 'INBOX')}`;
        if (att.filename) url += `&filename=${encodeURIComponent(att.filename)}`;
        if (forInline) {
            url += `&inline=true`;
            if (att.content_type) url += `&content_type=${encodeURIComponent(att.content_type)}`;
        }
        return url;
    };

    const fmtSize = (s) => s > 1024 * 1024 ? `${(s / 1024 / 1024).toFixed(1)} MB` : `${Math.round(s / 1024)} KB`;

    const AttIcon = ({ ct }) => {
        if (ct?.includes('pdf')) return <FileText size={16} className="text-red-500 shrink-0" />;
        if (ct?.startsWith('image/')) return <FileIcon size={16} className="text-blue-400 shrink-0" />;
        return <FileIcon size={16} className="text-[var(--gnosi-blue)] shrink-0" />;
    };

    const activeAtt = previewIndex !== null ? attachments[previewIndex] : null;
    const isPdfActive = activeAtt && (activeAtt.content_type?.includes('pdf') || activeAtt.filename?.toLowerCase().endsWith('.pdf'));
    const isImageActive = activeAtt && activeAtt.content_type?.startsWith('image/');

    return (
        <div className="mt-6 mb-2">
            <div className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-3 flex items-center gap-2">
                <Paperclip size={12} /> {t('mail.attachments_count', { count: attachments.length })}
            </div>

            {/* Chips */}
            <div className="flex flex-wrap gap-2">
                {attachments.map((att, i) => {
                    const canPreview = att.content_type?.includes('pdf') || att.filename?.toLowerCase().endsWith('.pdf') || att.content_type?.startsWith('image/');
                    const isActive = previewIndex === i;
                    return (
                        <div key={i} className="flex items-center gap-1">
                            <a
                                href={attUrl(att)}
                                download={att.filename}
                                className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--sidebar-item-active)] hover:text-[var(--gnosi-blue)] transition-all max-w-[220px]"
                                title={t('mail.download_attachment', "Download")}
                            >
                                <AttIcon ct={att.content_type} />
                                <span className="truncate">{att.filename}</span>
                                <span className="text-[11px] text-[var(--text-secondary)] shrink-0">{fmtSize(att.size)}</span>
                            </a>
                            {canPreview && (
                                <button
                                    onClick={() => setPreviewIndex(isActive ? null : i)}
                                    className={`px-2 py-2 border rounded-xl text-[11px] font-bold transition-all shrink-0 ${isActive ? 'bg-[var(--gnosi-blue)] text-white border-[var(--gnosi-blue)]' : 'bg-[var(--bg-secondary)] border-[var(--border-primary)] text-[var(--gnosi-blue)] hover:bg-[var(--sidebar-item-active)]'}`}
                                    title={t('mail.preview_attachment', "Preview")}
                                >{isActive ? '▲' : '▼'}</button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Preview panel */}
            {activeAtt && (
                <div className="mt-4 w-full">
                    {isPdfActive && <PdfViewer url={attUrl(activeAtt, { forInline: true })} />}
                    {isImageActive && (
                        <img
                            src={attUrl(activeAtt, { forInline: true })}
                            alt={activeAtt.filename}
                            className="w-full rounded-xl border border-[var(--border-primary)]"
                            style={{ maxHeight: '75vh', objectFit: 'contain' }}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

function MailBody({ bodyHtml, bodyText, messageId, email, folder }) {
    const iframeRef = useRef(null);
    const [height, setHeight] = useState(200);
    const [darkBody, setDarkBody] = useState(readMailDarkBody);

    useEffect(() => {
        const onChange = () => setDarkBody(readMailDarkBody());
        window.addEventListener(MAIL_DARK_BODY_EVENT, onChange);
        window.addEventListener('storage', onChange);
        return () => {
            window.removeEventListener(MAIL_DARK_BODY_EVENT, onChange);
            window.removeEventListener('storage', onChange);
        };
    }, []);

    useEffect(() => {
        if (!bodyHtml || !iframeRef.current) return;
        const iframe = iframeRef.current;
        const onLoad = () => {
            try {
                const doc = iframe.contentDocument;
                doc.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
                const newH = Math.max(200, doc.documentElement.scrollHeight + 20);
                setHeight(newH);
            } catch {}
        };
        iframe.addEventListener('load', onLoad);
        return () => iframe.removeEventListener('load', onLoad);
    }, [bodyHtml, darkBody]);

    if (bodyHtml) {
        const sanitized = sanitizeHtml(bodyHtml);
        const withCid = messageId && email
            ? sanitized.replace(/cid:([^"'\s>)]+)/gi, (_, cid) =>
                `/api/mail/messages/${messageId}/cid/${encodeURIComponent(cid)}?email=${encodeURIComponent(email)}&folder=${encodeURIComponent(folder || 'INBOX')}`)
            : sanitized;
        const css = darkBody ? EMAIL_CSS_DARK : EMAIL_CSS_LIGHT;
        const src = `<style>${css}</style>${withCid}`;
        return (
            <iframe
                ref={iframeRef}
                srcDoc={src}
                sandbox="allow-same-origin allow-popups"
                title="mail-body"
                style={{
                    width: '100%',
                    border: 'none',
                    height: `${height}px`,
                    display: 'block',
                    borderRadius: '12px',
                    background: darkBody ? '#1a1a1a' : '#fff',
                }}
            />
        );
    }

    const text = bodyText || '';
    // XSS prevention: the text comes from emails (attacker-controllable). It must be escaped
    // special HTML before doing the URL replace, otherwise `<script>...</script>`
    // inside the text would execute in the dangerouslySetInnerHTML.
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const linked = escaped.replace(
        /(https?:\/\/[^\s<>"']+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#3b82f6">$1</a>'
    );
    return (
        <div
            className="text-[15px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words font-sans"
            dangerouslySetInnerHTML={{ __html: linked }}
        />
    );
}

export default function MailViewer({ account, mail: selectedMail, onClose, onMailRead, onActionDone, onMoved, onCompose }) {
    const { t } = useTranslation();
    const [mailData, setMailData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [showSnooze, setShowSnooze] = useState(false);
    const [snoozeMenuPos, setSnoozeMenuPos] = useState({ x: 0, y: 0 });
    const [showMove, setShowMove] = useState(false);
    const [moveMenuPos, setMoveMenuPos] = useState({ x: 0, y: 0 });
    const [moveFolders, setMoveFolders] = useState([]);
    const [moving, setMoving] = useState(false);
    const moveBtnRef = useRef(null);
    const [expandedThreadIds, setExpandedThreadIds] = useState(new Set());
    const [threadMsgData, setThreadMsgData] = useState({});
    const [extractedEntities, setExtractedEntities] = useState(null);
    const [showEventCalendarPicker, setShowEventCalendarPicker] = useState(null);
    const [availableCalendars, setAvailableCalendars] = useState([]);
    const scannedIdsRef = useRef(new Set());
    const [showTagPicker, setShowTagPicker] = useState(false);
    const [tagPickerAnchor, setTagPickerAnchor] = useState(null);
    const [activeTagIds, setActiveTagIds] = useState([]);
    const tagBtnRef = useRef(null);
    const { tags, createTag, deleteTag, getMessageTags, setMessageTags } = useMailTags();
    const calendarPickerRef = useRef(null);

    // Esc closes the action bar's overlays. We call the hooks at the level
    // above (before any early return below) to respect the order.
    //   - Calendar picker: modal dialog → Esc + focus-trap (no Enter: each
    //     calendar is its own button).
    //   - Move / Snooze: dropdowns → only Esc.
    useModalKeyboard({
        isOpen: !!showEventCalendarPicker,
        onClose: () => setShowEventCalendarPicker(null),
        containerRef: calendarPickerRef,
        trapFocus: true,
    });
    useModalKeyboard({ isOpen: showMove, onClose: () => setShowMove(false) });
    useModalKeyboard({ isOpen: showSnooze, onClose: () => setShowSnooze(false) });

    const [fullThreadMsgs, setFullThreadMsgs] = useState([]);

    const threadMessages = selectedMail?.thread_messages || [];
    // Prefer server-fetched full thread; fall back to client-side grouping
    const allThreadMsgs = fullThreadMsgs.length > 0
        ? fullThreadMsgs
        : (threadMessages.length > 0 ? threadMessages : (selectedMail ? [selectedMail] : []));

    // Fetch full thread from backend when message changes (includes SENT siblings)
    useEffect(() => {
        setFullThreadMsgs([]);
        setThreadMsgData({});
        if (!selectedMail?.id) return;

        const tid = selectedMail.thread_id;
        const email = selectedMail.account || account?.email || '';
        // Only Gmail threads have a different thread_id
        if (!tid || tid === selectedMail.id || !email || selectedMail.source === 'vault') return;

        // Race guard: if the message changes while this fetch is in flight, the
        // late response must not write to the previous message's thread.
        let cancelled = false;
        fetch(`/api/mail/threads/${encodeURIComponent(tid)}?email=${encodeURIComponent(email)}`)
            .then(r => r.json())
            .then(data => {
                if (cancelled) return;
                const msgs = (data.messages || []).slice().reverse(); // newest first
                if (msgs.length > 1) setFullThreadMsgs(msgs);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [selectedMail?.id]);

    // Auto-expand newest message when thread changes
    useEffect(() => {
        if (allThreadMsgs.length > 0) {
            setExpandedThreadIds(new Set([allThreadMsgs[0].id]));
        }
    }, [selectedMail?.id]);

    // Load tags for the current message
    useEffect(() => {
        if (!selectedMail?.id) { setActiveTagIds([]); return; }
        // Race guard: a late response must not paint the labels of the
        // previous message over the new one.
        let cancelled = false;
        getMessageTags(selectedMail.id)
            .then(tags => { if (!cancelled) setActiveTagIds(tags); })
            .catch(() => { if (!cancelled) setActiveTagIds([]); });
        return () => { cancelled = true; };
    }, [selectedMail?.id]);

    const toggleThreadMsg = (msg) => {
        const id = msg.id;
        const willExpand = !expandedThreadIds.has(id);
        setExpandedThreadIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
        // Lazy fetch body for older messages not yet loaded
        if (willExpand && id !== mailData?.id && !threadMsgData[id]) {
            const msgEmail = msg.account || account?.email || '';
            const msgFolder = msg.imap_folder || '';
            const params = new URLSearchParams();
            if (msgEmail) params.set('email', msgEmail);
            if (msgFolder) params.set('folder', msgFolder);
            fetch(`/api/mail/messages/${id}?${params}`)
                .then(r => r.json())
                .then(data => setThreadMsgData(prev => ({ ...prev, [id]: data })))
                .catch(() => {});
        }
    };

    const isSentMsg = (msg) => {
        const effectiveEmail = account?.email || '';
        const senderRaw = msg.sender || '';
        const senderEmail = senderRaw.match(/<([^>]+)>/)?.[1]?.toLowerCase() || senderRaw.toLowerCase();
        return msg.type === 'Sent' || (effectiveEmail && senderEmail.includes(effectiveEmail.toLowerCase()));
    };

    useEffect(() => {
        if (!selectedMail?.id) { setMailData(null); return; }
        // Race guard: when quickly jumping from one message to another (the IMAP
        // fetches can be slow), the late response for the PREVIOUS message must not
        // of overwriting the body of the new one or marking it read/scanning it.
        let cancelled = false;
        setLoading(true);
        const msgEmail = selectedMail.account || account?.email || '';
        const msgFolder = selectedMail.imap_folder || '';
        const params = new URLSearchParams();
        if (msgEmail) params.set('email', msgEmail);
        if (msgFolder) params.set('folder', msgFolder);
        fetch(`/api/mail/messages/${selectedMail.id}?${params}`)
            .then(res => res.json())
            .then(data => {
                if (cancelled) return;
                setMailData(data);
                setLoading(false);
                if (!data.is_read) markAsRead(data.id, msgEmail);
                // Auto-scan entities on first open
                if (!scannedIdsRef.current.has(data.id) && (data.body_text || data.snippet)) {
                    scannedIdsRef.current.add(data.id);
                    extractEntities(data.body_text || data.snippet);
                }
            })
            .catch(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [selectedMail]);

    const extractEntities = async (context) => {
        if (!context) return;
        setExtractedEntities(null);
        try {
            const res = await fetch('/api/mail/ai/extract_entities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context })
            });
            const data = await res.json();
            if (data.events?.length > 0 || data.contacts?.length > 0) {
                setExtractedEntities(data);
                toast.success(t('mail.smart_suggestions_found', "Smart suggestions found"));
            }
        } catch {
            toast.error(t('mail.smart_analysis_error', "Error during smart analysis"));
        }
    };

    const handleAddExtractedContact = async (contact) => {
        try {
            await axios.post('/api/contacts', {
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                company: contact.company,
                notes: contact.notes + `\n\n${t('mail.extracted_from_email_label', "Extracted from the email")}: ${mailData?.subject}`
            });
            toast.success(t('mail.contact_added', "Contact {{name}} added", { name: contact.name }));
            setExtractedEntities(prev => ({
                ...prev,
                contacts: prev.contacts.filter(c => c.email !== contact.email)
            }));
        } catch {
            toast.error(t('mail.add_contact_error', "Error adding the contact"));
        }
    };

    const handleOpenCalendarPicker = async (event) => {
        setShowEventCalendarPicker(event);
        if (availableCalendars.length === 0) {
            try {
                const res = await axios.get(`/api/calendar/calendars?email=${encodeURIComponent(account?.email || '')}`);
                setAvailableCalendars(res.data);
            } catch {
                toast.error(t('mail.load_calendars_error', "Error loading calendars"));
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
                description: event.description + `\n\n${t('mail.from_email_label', "From the email")}: ${mailData?.subject}`
            });
            toast.success(t('mail.event_added_to_calendar', "Event \"{{title}}\" added to the calendar", { title: event.title }));
            setShowEventCalendarPicker(null);
            setExtractedEntities(prev => ({
                ...prev,
                events: prev.events.filter(e => e.title !== event.title)
            }));
        } catch {
            toast.error(t('mail.add_event_error', "Error adding the event"));
        }
    };

    const markAsRead = (id, msgEmail) => {
        const email = msgEmail || account?.email;
        if (!email) return;
        // We pass `folder` so the backend can apply \Seen on the server
        // IMAP even when the message hasn't been synced to the
        // vault (without this fallback, mark_read would return False, the cache
        // of counts wasn't invalidated and the sidebar kept the old counter).
        const folder = mailData?.imap_folder || selectedMail?.imap_folder || '';
        const folderQuery = folder ? `&folder=${encodeURIComponent(folder)}` : '';
        fetch(`/api/mail/messages/${id}/read?email=${encodeURIComponent(email)}${folderQuery}`, {
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
        }).catch(() => toast.error(t('mail.update_metadata_error', "Error updating metadata")));
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
        toast.success(t('mail.autofill_starting', "Starting smart autofill..."));
        try {
            // Load the current bunker profile
            const res = await axios.get('/api/identity');
            const profile = res.data;

            if (window.electronAPI?.openFormFiller) {
                window.electronAPI.openFormFiller(url, profile);
            } else {
                // Fallback if we're not in Electron
                window.open(url, '_blank');
                toast.error(t('mail.autofill_desktop_only', "Autofill is only available in the desktop app"));
            }
        } catch (error) {
            console.error('Error loading profile to fill form:', error);
            window.open(url, '_blank');
        }
    };

    const handleAddToVault = async () => {
        if (!mailData) return;
        try {
            const title = mailData.subject || 'Correu sense assumpte';
            const content = `# ${title}\n\n**${t('mail.from_label', "From")}:** ${mailData.sender}\n**${t('mail.date_label', "Date")}:** ${mailData.date}\n\n---\n\n${mailData.body_text || ''}`;
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
            toast.error(t('mail.snooze_error', "Error setting reminder"));
        }
    };

    const buildQuotedHtml = (data) => {
        const header = `<strong>${t('mail.from_label')}:</strong> ${escapeHtml(data.sender)} &nbsp;|&nbsp; <strong>${t('mail.date_label')}:</strong> ${escapeHtml(data.date)} &nbsp;|&nbsp; <strong>${t('mail.subject_label')}:</strong> ${escapeHtml(data.subject)}`;
        let content = data.body_html
            ? sanitizeHtml(data.body_html)
            : (data.body_text || '').replace(/\n/g, '<br>');
        // Inline images in the quoted message (src="cid:...") are rewritten
        // in the API URL (as MailBody does in the iframe): BlockNote discards
        // the cid: src (the image would disappear from the reply), whereas
        // the /cid/ URL is shown in the composer and, on send, the backend
        // is converted into its own inline part (see mail_inline_images_cid.md).
        const msgEmail = data.account || account?.email || '';
        if (data.body_html && data.id && msgEmail) {
            content = content.replace(/src=(["'])cid:([^"']+)\1/gi, (_, q, cid) =>
                `src=${q}/api/mail/messages/${data.id}/cid/${encodeURIComponent(cid)}?email=${encodeURIComponent(msgEmail)}&folder=${encodeURIComponent(data.imap_folder || 'INBOX')}${q}`);
        }
        return `<div style="font-size:12px;margin-bottom:6px;opacity:0.7">${header}</div><hr style="opacity:0.2;margin:6px 0">${content}`;
    };

    const handleReply = () => {
        if (!mailData) return;
        onCompose?.({
            mode: 'reply',
            replyToMessageId: mailData.id,
            sourceFolder: mailData.imap_folder || '',
            initialTo: mailData.sender || '',
            initialSubject: `Re: ${mailData.subject || ''}`,
            quotedHtml: buildQuotedHtml(mailData),
        });
    };

    const handleReplyAll = () => {
        if (!mailData) return;
        onCompose?.({
            mode: 'reply_all',
            replyToMessageId: mailData.id,
            sourceFolder: mailData.imap_folder || '',
            initialTo: mailData.sender || '',
            initialCc: mailData.recipient || '',
            initialSubject: `Re: ${mailData.subject || ''}`,
            quotedHtml: buildQuotedHtml(mailData),
        });
    };

    const handleForward = () => {
        if (!mailData) return;
        onCompose?.({
            mode: 'forward',
            replyToMessageId: mailData.id,
            sourceFolder: mailData.imap_folder || '',
            initialTo: '',
            initialSubject: `Fwd: ${mailData.subject || ''}`,
            quotedHtml: buildQuotedHtml(mailData),
        });
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
        }).catch(() => toast.error(t('mail.mark_error', "Error marking")));
        toast.success(newValue ? t('mail.starred_added') : t('mail.starred_removed'));
    };

    const handleArchive = () => {
        if (!mailData?.id || !effectiveEmail) return;
        const folderParam = mailData.imap_folder ? `&folder=${encodeURIComponent(mailData.imap_folder)}` : '';
        fetch(`/api/mail/messages/${mailData.id}/archive?email=${encodeURIComponent(effectiveEmail)}${folderParam}`, { method: 'POST' })
            .then(res => {
                if (!res.ok) throw new Error('archive_failed');
                onActionDone?.(mailData.id, 'archive', effectiveEmail, { imap_uid: mailData.imap_uid, imap_folder: mailData.imap_folder });
            })
            .catch(() => toast.error(t('mail.archive_error')));
    };

    const handleDelete = () => {
        if (!mailData?.id) return;
        // Vault drafts don't live on the IMAP server — they're deleted via
        // the dedicated /drafts/{id} endpoint (DELETE). If we POST /trash on
        // a vault draft, the backend can't find the message and the file
        // markdown remains on disk (it reappears when the list is reloaded).
        const isVaultDraft = (mailData.source === 'vault') || (selectedMail?.source === 'vault');
        if (isVaultDraft) {
            fetch(`/api/mail/drafts/${mailData.id}`, { method: 'DELETE' })
                .then(res => {
                    if (!res.ok) throw new Error('delete_draft_failed');
                    // We pass actionType='delete_draft' (not 'trash') so that
                    // handleActionDone does NOT trigger the undo: a vault draft
                    // is deleted from disk, not moved to the server's Trash,
                    // so a subsequent POST /messages/{id}/move would fail.
                    onActionDone?.(mailData.id, 'delete_draft', effectiveEmail);
                })
                .catch(() => toast.error(t('mail.delete_error')));
            return;
        }
        if (!effectiveEmail) return;
        const folderParam = mailData.imap_folder ? `&folder=${encodeURIComponent(mailData.imap_folder)}` : '';
        fetch(`/api/mail/messages/${mailData.id}/trash?email=${encodeURIComponent(effectiveEmail)}${folderParam}`, { method: 'POST' })
            .then(res => {
                if (!res.ok) throw new Error('trash_failed');
                onActionDone?.(mailData.id, 'trash', effectiveEmail, { imap_uid: mailData.imap_uid, imap_folder: mailData.imap_folder });
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
            if (newValue) onClose?.(); // If we mark it as spam, we close the viewer
        })
        .catch(() => {
            toast.error(t('mail.error_updating'));
            setMailData(prev => ({ ...prev, is_spam: !newValue, category: !newValue ? 'SPAM' : 'Main' }));
        });
    };

    const handleOpenMove = async () => {
        if (!effectiveEmail) return;
        if (moveBtnRef.current) {
            const rect = moveBtnRef.current.getBoundingClientRect();
            setMoveMenuPos({ x: rect.left, y: rect.bottom + 4 });
        }
        setShowMove(v => !v);
        if (moveFolders.length === 0) {
            try {
                const res = await fetch(`/api/mail/folders?email=${encodeURIComponent(effectiveEmail)}`);
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
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_folder: folderName, imap_uid: mailData.imap_uid, imap_folder: mailData.imap_folder }) }
            );
            if (res.ok) {
                toast.success(t('mail.moved_to_folder', "Moved to {{folder}}", { folder: folderName }));
                onMoved ? onMoved(mailData.id) : onClose?.();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err.detail || t('mail.move_message_error', "Error moving the message"));
            }
        } catch {
            toast.error(t('mail.move_message_error', "Error moving the message"));
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

    return (
        <div className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden font-sans">
            {/* Action Bar */}
            <div className="h-14 border-b border-[var(--border-primary)] flex items-center bg-[var(--bg-primary)]/80 backdrop-blur-xl sticky top-0 z-20">
                <div className="flex-1 overflow-x-auto scrollbar-hide flex items-center gap-1 pl-6 pr-2">
                    <button onClick={handleAddToVault} title={t('mail.add_to_vault')} className="p-2 hover:bg-[var(--sidebar-item-active)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] transition-all flex items-center gap-2 text-sm font-medium">
                        <ExternalLink size={16} />
                        <span className="hidden xl:block">{t('mail.add_to_vault')}</span>
                    </button>
                    <div className="w-px h-5 bg-[var(--border-primary)] mx-1" />
                    <button onClick={handleReply} title={t('mail.reply_title')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"><Reply size={16} /></button>
                    <button onClick={handleReplyAll} title={t('mail.reply_all_title')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"><ReplyAll size={16} /></button>
                    <button onClick={handleForward} title={t('mail.forward_title')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"><Forward size={16} /></button>
                    <div className="w-px h-5 bg-[var(--border-primary)] mx-1" />
                    <button onClick={handleArchive} title={t('mail.archive_action')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"><Archive size={16} /></button>

                    {/* Tag picker */}
                    <div className="relative">
                        <button
                            ref={tagBtnRef}
                            title={t('mail.labels', "Labels")}
                            onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setTagPickerAnchor(rect);
                                setShowTagPicker(v => !v);
                            }}
                            className={`p-2 rounded-xl transition-all flex items-center gap-1.5 ${activeTagIds.length > 0 ? 'text-[var(--gnosi-blue)] bg-[var(--sidebar-item-active)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                        >
                            <Tag size={16} />
                            {activeTagIds.length > 0 && <span style={{ fontSize: 11, fontWeight: 700 }}>{activeTagIds.length}</span>}
                        </button>
                        {showTagPicker && (
                            <MailTagPicker
                                tags={tags}
                                selectedTagIds={activeTagIds}
                                anchorRect={tagPickerAnchor}
                                onClose={() => setShowTagPicker(false)}
                                onToggleTag={async (tagId) => {
                                    const next = activeTagIds.includes(tagId)
                                        ? activeTagIds.filter(id => id !== tagId)
                                        : [...activeTagIds, tagId];
                                    setActiveTagIds(next);
                                    await setMessageTags(selectedMail.id, next, {
                                        account_email: account?.email || selectedMail?.account || '',
                                        subject: selectedMail?.subject || '',
                                        sender: selectedMail?.sender || '',
                                        date: selectedMail?.date || '',
                                    }).catch(() => {});
                                }}
                                onCreateTag={async (data) => { await createTag(data); }}
                                onDeleteTag={async (id) => {
                                    await deleteTag(id);
                                    setActiveTagIds(prev => prev.filter(tid => tid !== id));
                                }}
                            />
                        )}
                    </div>

                    {/* Move to folder dropdown */}
                    <div className="relative">
                        <button
                            ref={moveBtnRef}
                            title={t('mail.move_to_folder_title', "Move to folder")}
                            onClick={handleOpenMove}
                            disabled={moving}
                            className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"
                        >
                            {moving ? <div className="w-[16px] h-[16px] border-2 border-current border-t-transparent rounded-full animate-spin" /> : <FolderInput size={16} />}
                        </button>
                        {showMove && createPortal(
                            <>
                                <div className="fixed inset-0" style={{ zIndex: 'var(--z-overlay)' }} onClick={() => setShowMove(false)} />
                                <div
                                    className="fixed bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg py-1 w-52 animate-in fade-in zoom-in-95 duration-150"
                                    style={{ left: moveMenuPos.x, top: moveMenuPos.y, zIndex: 'var(--z-popover)' }}
                                >
                                    <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('mail.move_to_ellipsis', "Move to...")}</div>
                                    {moveFolders.length === 0
                                        ? <div className="px-3 py-2 text-[13px] text-[var(--text-secondary)]">{t('common.loading', "Loading...")}</div>
                                        : moveFolders
                                            .filter(f => f.name !== mailData?.imap_folder)
                                            .map(f => (
                                                <button
                                                    key={f.name}
                                                    onClick={() => handleMoveToFolder(f.name)}
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
                    </div>

                    {/* Snooze dropdown */}
                    <div className="relative">
                        <button
                            title={t('mail.snooze')}
                            onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setSnoozeMenuPos({ x: rect.left, y: rect.bottom + 4 });
                                setShowSnooze(v => !v);
                            }}
                            className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all flex items-center gap-1"
                        >
                            <Clock size={16} />
                        </button>
                        {showSnooze && createPortal(
                            <>
                                <div className="fixed inset-0" style={{ zIndex: 'var(--z-overlay)' }} onClick={() => setShowSnooze(false)} />
                                <div
                                    className="fixed bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg py-1 w-48 animate-in fade-in zoom-in-95 duration-150"
                                    style={{ left: snoozeMenuPos.x, top: snoozeMenuPos.y, zIndex: 'var(--z-popover)' }}
                                >
                                    <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('mail.snooze')}</div>
                                    {[['1h', 'snooze_1h'], ['tomorrow', 'snooze_tomorrow'], ['next_week', 'snooze_next_week']].map(([key, labelKey]) => (
                                        <button key={key} onClick={() => handleSnooze(key)} className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors">
                                            {t(`mail.${labelKey}`)}
                                        </button>
                                    ))}
                                </div>
                            </>,
                            document.body
                        )}
                    </div>

                    <button onClick={handleDelete} title={t('mail.delete_action')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-all"><Trash2 size={16} /></button>
                    <button 
                        onClick={handleToggleSpam} 
                        title={isSpam ? t('mail.unmark_spam_title', "Not spam (Move to inbox)") : t('mail.mark_spam_title', "Mark as spam")}
                        className={`p-2 rounded-xl transition-all flex items-center gap-2 text-sm font-medium ${
                            isSpam 
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-amber-600'
                        }`}
                    >
                        <ShieldAlert size={16} fill={isSpam ? 'currentColor' : 'none'} />
                    </button>
                </div>

                <div className="flex items-center gap-1 shrink-0 px-2 border-l border-[var(--border-primary)]">
                    <button
                        onClick={handleToggleStar}
                        className={`p-2 rounded-xl transition-all ${mailData?.is_starred ? 'text-[var(--status-warning)] bg-[var(--bg-secondary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                    >
                        <Star size={16} fill={mailData?.is_starred ? 'currentColor' : 'none'} />
                    </button>
                    <button onClick={onClose} title={t('common.close')} className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all active:scale-90"><CloseIcon size={16} /></button>
                </div>
            </div>

            {/* Content */}
            <div data-role="mail-viewer-scroll" className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
                <div className="max-w-5xl mx-auto px-6 lg:px-12 pt-8">
                    {/* Subject + meta badges */}
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)] leading-tight mb-3 tracking-tight">
                        {mailData?.subject}
                    </h1>
                    <div className="flex flex-wrap gap-2 items-center mb-6">
                        <div className="flex items-center gap-1.5 bg-[var(--bg-secondary)] px-2 py-1 rounded-lg border border-[var(--border-primary)]">
                            <Tag size={11} className="text-[var(--text-secondary)]" />
                            <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{mailData?.category || t('mail.category_general', 'General')}</span>
                        </div>
                        {activeTagIds.map(tid => {
                            const tag = tags.find(t => t.id === tid);
                            return tag ? (
                                <TagPill
                                    key={tid}
                                    tag={tag}
                                    onRemove={async (id) => {
                                        const next = activeTagIds.filter(x => x !== id);
                                        setActiveTagIds(next);
                                        await setMessageTags(selectedMail.id, next, {
                                            account_email: account?.email || selectedMail?.account || '',
                                            subject: selectedMail?.subject || '',
                                            sender: selectedMail?.sender || '',
                                            date: selectedMail?.date || '',
                                        }).catch(() => {});
                                    }}
                                />
                            ) : null;
                        })}
                        {allThreadMsgs.length > 1 && (
                            <div className="flex items-center gap-1.5 bg-[var(--bg-secondary)] px-2 py-1 rounded-lg border border-[var(--border-primary)]">
                                <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{t('mail.thread_messages_count', { count: allThreadMsgs.length })}</span>
                            </div>
                        )}
                        {formLinks.length > 0 && formLinks.map((link, i) => (
                            <button key={i} onClick={() => handleFillForm(link)}
                                className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white px-2.5 py-1 rounded-lg shadow-sm hover:shadow-md transition-all animate-pulse hover:animate-none">
                                <FileText size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">{t('mail.fill_form_button', "Fill Form")}</span>
                            </button>
                        ))}
                    </div>

                    {/* Thread — newest first */}
                    <div className="space-y-2 mb-8">
                        {allThreadMsgs.map((msg, idx) => {
                            const isMain = msg.id === mailData?.id || (idx === 0 && !mailData);
                            const isExpanded = expandedThreadIds.has(msg.id);
                            const sent = isSentMsg(msg);
                            const senderName = sent ? t('mail.you_label', "You") : cleanName(msg.sender);
                            const fullContent = isMain ? mailData : threadMsgData[msg.id];
                            const dateLabel = msg.timestamp
                                ? format(new Date(msg.timestamp * 1000), 'd MMM yyyy · HH:mm', { locale: ca })
                                : '';
                            return (
                                <div key={msg.id} className={`rounded-xl overflow-hidden border transition-all ${
                                    sent
                                        ? 'border-[var(--gnosi-blue)]/40 bg-[var(--sidebar-item-active)]/40'
                                        : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
                                }`}>
                                    {/* Card header */}
                                    <button
                                        type="button"
                                        onClick={() => toggleThreadMsg(msg)}
                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-secondary)]/60 transition-colors text-left"
                                    >
                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-[12px] font-bold shrink-0 ${
                                            sent
                                                ? 'bg-[var(--gnosi-blue)] text-white'
                                                : 'bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)]'
                                        }`}>
                                            {senderName[0]?.toUpperCase() || '?'}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`text-[13px] font-bold ${sent ? 'text-[var(--gnosi-blue)]' : 'text-[var(--text-primary)]'}`}>
                                                    {senderName}
                                                </span>
                                                {sent && <span className="text-[10px] font-bold text-[var(--gnosi-blue)]/60 uppercase tracking-wider">{t('mail.sent_badge', "sent")}</span>}
                                                {!sent && !isExpanded && (
                                                    <span className="text-[12px] text-[var(--text-secondary)] truncate opacity-60 max-w-[300px]">
                                                        {msg.snippet}
                                                    </span>
                                                )}
                                            </div>
                                            {isExpanded && (
                                                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                                                    {sent
                                                        ? `${t('mail.to_label_short', "To")}: ${cleanName(msg.recipient || mailData?.recipient)}`
                                                        : `${t('mail.to_label', "To")}: ${cleanName(msg.recipient || mailData?.recipient)}`}
                                                    {(msg.cc || (isMain && mailData?.cc)) && (
                                                        <span className="ml-2 opacity-70">{t('mail.cc_label', 'CC')}: {cleanName(msg.cc || mailData?.cc)}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-[11px] text-[var(--text-secondary)] font-medium">{dateLabel}</span>
                                            <ChevronDown size={14} className={`text-[var(--text-secondary)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                        </div>
                                    </button>

                                    {/* Card body */}
                                    {isExpanded && (
                                        <div className="border-t border-[var(--border-primary)]/60 px-5 py-5">
                                            {fullContent ? (
                                                <>
                                                    <MailBody
                                                        bodyHtml={fullContent.body_html}
                                                        bodyText={fullContent.body_text || msg.snippet || ''}
                                                        messageId={msg.id}
                                                        email={msg.account || account?.email}
                                                        folder={msg.imap_folder}
                                                    />
                                                    {fullContent.attachments?.length > 0 && (
                                                        <AttachmentList
                                                            attachments={fullContent.attachments}
                                                            messageId={msg.id}
                                                            email={msg.account || account?.email}
                                                            folder={msg.imap_folder}
                                                        />
                                                    )}
                                                </>
                                            ) : (
                                                <div className="flex items-center justify-center py-8">
                                                    <div className="w-5 h-5 border-2 border-[var(--gnosi-blue)] border-t-transparent rounded-full animate-spin" />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Extracted Entities Panel */}
                    {extractedEntities && (extractedEntities.events.length > 0 || extractedEntities.contacts.length > 0) && (
                        <div className="bg-[var(--bg-secondary)]/50 border border-[var(--border-primary)] rounded-3xl p-8 mb-12 animate-in fade-in slide-in-from-top-4 duration-500 backdrop-blur-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg">
                                    <Sparkles size={20} />
                                </div>
                                <h3 className="text-xl font-bold text-[var(--text-primary)]">{t('mail.smart_suggestions', "Smart suggestions")}</h3>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Events */}
                                {extractedEntities.events.length > 0 && (
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest flex items-center gap-2">
                                            <CalendarCheck size={14} /> {t('calendar.title', "Calendar")}
                                        </h4>
                                        {extractedEntities.events.map((event, idx) => (
                                            <div key={idx} className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group">
                                                <div className="font-bold text-[var(--text-primary)] mb-2 group-hover:text-[var(--gnosi-blue)] transition-colors">{event.title}</div>
                                                <div className="text-xs text-[var(--text-secondary)] space-y-1.5 mb-4">
                                                    <div className="flex items-center gap-2">
                                                        <Clock size={12} className="opacity-60" />
                                                        {event.start ? format(new Date(event.start), 'd MMM, HH:mm', { locale: ca }) : t('mail.event_date_unspecified', "Date not specified")}
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
                                                    <CalendarCheck size={14} /> {t('mail.add_to_calendar_button', "Add to calendar")}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Contacts */}
                                {extractedEntities.contacts.length > 0 && (
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest flex items-center gap-2">
                                            <UserPlus size={14} /> {t('contacts.title', "Contacts")}
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
                                                    <UserPlus size={14} /> {t('mail.add_to_contacts_button', "Add to contacts")}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                </div>
            </div>

            {/* Calendar Picker Modal */}
            {showEventCalendarPicker && (
                <div
                    className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setShowEventCalendarPicker(null); }}
                >
                    <div
                        ref={calendarPickerRef}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="bg-[var(--bg-primary)] w-full max-w-md rounded-3xl shadow-2xl border border-[var(--border-primary)] overflow-hidden animate-in zoom-in-95 duration-200"
                    >
                        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)]/50">
                            <h3 className="font-bold text-[var(--text-primary)]">{t('mail.choose_calendar_title', "Choose a calendar")}</h3>
                            <button onClick={() => setShowEventCalendarPicker(null)} className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors">
                                <CloseIcon size={18} />
                            </button>
                        </div>
                        <div className="p-4 max-h-[300px] overflow-y-auto">
                            {availableCalendars.length === 0 ? (
                                <div className="p-8 text-center text-[var(--text-secondary)]">{t('mail.loading_calendars', "Loading calendars...")}</div>
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
                                            <div className="text-sm font-bold text-[var(--text-primary)]">{t('mail.gnosi_vault_local', 'Gnosi Vault (Local)')}</div>
                                            <div className="text-[10px] text-[var(--text-secondary)] opacity-60 font-mono uppercase">{t('common.local', 'Local')}</div>
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
