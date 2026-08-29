import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Send, Loader2, RefreshCw, AlertTriangle, Sparkles, ArrowLeft } from 'lucide-react';
import { toast } from '../../lib/toast';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { fetchVaultPage } from '../../shared/api/vaults';
import {
    composeSocialPosts,
    fetchSocialNetworks,
    publishSocialPosts,
    scheduleSocialPosts,
} from '../../shared/api/social';

// "Post to social media" modal: pick networks → the AI proposes adapted text for
// each one (in the SAME language as the original) → you edit/regenerate → you publish or
// schedule. The actual publishing and the record in the "Social Publications" table
// are handled by the backend (/api/social/compose, /publish, /schedule).
//
// It can be opened from a Vault record (passing `noteId`: it takes the title and body
// of the page) or in free mode (without `noteId`: the user writes the content).
export function PublishSocialModal({ isOpen, onClose, noteId = null, recordMetadata = {}, onPublished }) {
    const { t } = useTranslation();
    const containerRef = useRef(null);

    const [networks, setNetworks] = useState([]);          // [{id,name,icon,configured,char_limit,...}]
    const [selected, setSelected] = useState(new Set());
    const [step, setStep] = useState('select');            // 'select' | 'compose'

    const [sourceTitle, setSourceTitle] = useState('');
    const [sourceContent, setSourceContent] = useState('');
    const [hint, setHint] = useState('');

    const [proposals, setProposals] = useState({});         // {net: {text,hashtags,char_count,over_limit,provider}}
    const [drafts, setDrafts] = useState({});               // {net: text editat}
    const [variationByNet, setVariationByNet] = useState({});
    const [regeneratingNet, setRegeneratingNet] = useState(null);

    const [composing, setComposing] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduledAt, setScheduledAt] = useState('');

    const busy = composing || publishing;

    // Reinitializes on open and loads networks + source content.
    useEffect(() => {
        if (!isOpen) return;
        setStep('select');
        setProposals({});
        setDrafts({});
        setVariationByNet({});
        setScheduleOpen(false);
        setScheduledAt('');
        setHint('');

        // Source content: the record's title as the starting point.
        setSourceTitle(String(recordMetadata?.title || '').trim());
        setSourceContent('');

        (async () => {
            try {
                const list = (await fetchSocialNetworks()).filter((n) => n.enabled !== false);
                setNetworks(list);
                // Preselects the configured ones.
                setSelected(new Set(list.filter((n) => n.configured).map((n) => n.id)));
            } catch (err) {
                console.error('Error loading networks:', err);
                toast.error(t('social.networks_error', "The networks could not be loaded."));
            }

            // If we come from a record, we load the page body to give
            // the AI better context. If it fails, we derive it from the metadata.
            if (noteId) {
                try {
                    const d = await fetchVaultPage(noteId);
                    setSourceTitle(String(d.title || d.metadata?.title || recordMetadata?.title || '').trim());
                    setSourceContent(String(d.content || '').trim() || deriveContent(recordMetadata));
                } catch (_error) {
                    setSourceContent(deriveContent(recordMetadata));
                }
            }
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, noteId]);

    const charLimitFor = (net) => networks.find((n) => n.id === net)?.char_limit || 280;
    const iconFor = (net) => networks.find((n) => n.id === net)?.icon || '🌐';
    const nameFor = (net) => networks.find((n) => n.id === net)?.name || net;

    const selectedList = useMemo(() => [...selected], [selected]);
    const overLimitNets = useMemo(
        () => selectedList.filter((net) => (drafts[net] || '').length > charLimitFor(net)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selectedList, drafts, networks],
    );

    const toggleNetwork = (id) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleGenerate = async () => {
        if (selected.size === 0) {
            toast.error(t('social.pick_network', "Select at least one network."));
            return;
        }
        if (!sourceContent.trim() && !sourceTitle.trim()) {
            toast.error(t('social.need_content', "Content is required to generate the posts."));
            return;
        }
        setComposing(true);
        try {
            const result = await composeSocialPosts({
                networks: selectedList,
                content: sourceContent,
                title: sourceTitle,
                source_page_id: noteId || null,
                hint,
            });
            const props = result.proposals || {};
            setProposals(props);
            setDrafts(Object.fromEntries(Object.entries(props).map(([net, p]) => [net, p.text || ''])));
            setStep('compose');
        } catch (err) {
            console.error('Error generating posts:', err);
            const msg = err.response?.data?.detail || err.message || t('errors.unknown', "Unknown error");
            toast.error(`${t('social.compose_error', "Error generating the proposals")}: ${msg}`);
        } finally {
            setComposing(false);
        }
    };

    const handleRegenerate = async (net) => {
        const v = (variationByNet[net] || 0) + 1;
        setRegeneratingNet(net);
        try {
            const result = await composeSocialPosts({
                networks: selectedList,
                content: sourceContent,
                title: sourceTitle,
                source_page_id: noteId || null,
                hint,
                regenerate_only: [net],
                variation: v,
            });
            const p = result.proposals?.[net];
            if (p) {
                setProposals((prev) => ({ ...prev, [net]: p }));
                setDrafts((prev) => ({ ...prev, [net]: p.text || '' }));
                setVariationByNet((prev) => ({ ...prev, [net]: v }));
            }
        } catch (err) {
            const msg = err.response?.data?.detail || err.message || t('errors.unknown', "Unknown error");
            toast.error(`${t('social.regen_error', "Error regenerating")}: ${msg}`);
        } finally {
            setRegeneratingNet(null);
        }
    };

    const buildPosts = () => {
        const posts = {};
        for (const net of selectedList) {
            const text = (drafts[net] || '').trim();
            if (text) posts[net] = { text };
        }
        return posts;
    };

    const handlePublish = async () => {
        const posts = buildPosts();
        if (Object.keys(posts).length === 0) {
            toast.error(t('social.nothing_to_publish', "There is no text to publish."));
            return;
        }
        if (overLimitNets.length > 0) {
            toast.error(t('social.over_limit', { nets: overLimitNets.map(nameFor).join(', '), defaultValue: "Exceeds the limit on: {{nets}}." }));
            return;
        }
        setPublishing(true);
        try {
            const result = await publishSocialPosts({
                posts,
                source_page_id: noteId || null,
                source_title: sourceTitle,
            });
            reportResults(result.results || {});
            if (onPublished) onPublished(result);
            onClose();
        } catch (err) {
            const msg = err.response?.data?.detail || err.message || t('errors.unknown', "Unknown error");
            toast.error(`${t('social.publish_error', "Error publishing")}: ${msg}`);
        } finally {
            setPublishing(false);
        }
    };

    const handleSchedule = async () => {
        const posts = buildPosts();
        if (Object.keys(posts).length === 0) {
            toast.error(t('social.nothing_to_publish', "There is no text to publish."));
            return;
        }
        if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
            toast.error(t('social.schedule_future', "Choose a future date."));
            return;
        }
        if (overLimitNets.length > 0) {
            toast.error(t('social.over_limit', { nets: overLimitNets.map(nameFor).join(', '), defaultValue: "Exceeds the limit on: {{nets}}." }));
            return;
        }
        setPublishing(true);
        try {
            const result = await scheduleSocialPosts({
                posts,
                scheduled_time: new Date(scheduledAt).toISOString(),
                source_page_id: noteId || null,
                source_title: sourceTitle,
            });
            toast.success(t('social.scheduled_ok', "Post scheduled."));
            if (onPublished) onPublished(result);
            onClose();
        } catch (err) {
            const msg = err.response?.data?.detail || err.message || t('errors.unknown', "Unknown error");
            toast.error(`${t('social.schedule_error', "Error scheduling")}: ${msg}`);
        } finally {
            setPublishing(false);
        }
    };

    const reportResults = (results) => {
        const oks = Object.entries(results).filter(([, r]) => r.status === 'success').map(([n]) => nameFor(n));
        const errs = Object.entries(results).filter(([, r]) => r.status === 'error').map(([n]) => nameFor(n));
        if (oks.length && !errs.length) {
            toast.success(t('social.published_ok', { nets: oks.join(', '), defaultValue: "Published to: {{nets}}." }));
        } else if (oks.length && errs.length) {
            toast.success(t('social.published_partial', { ok: oks.join(', '), err: errs.join(', '), defaultValue: "Published to {{ok}}. Failed on {{err}}." }));
        } else {
            toast.error(t('social.published_none', { nets: errs.join(', '), defaultValue: "Could not publish to: {{nets}}." }));
        }
    };

    useModalKeyboard({ isOpen, onClose, containerRef, trapFocus: true });

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm"
        >
            <div
                ref={containerRef}
                className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col border border-[var(--border-primary)]"
                role="dialog"
                aria-modal="true"
                aria-label={t('social.publish_title', 'Publish to social media')}
            >
                <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Send size={18} className="text-[var(--gnosi-primary)]" />
                        {t('social.publish_title', "Publish to social media")}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label={t('common.close', "Close")} disabled={busy}>
                        <X />
                    </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                    {step === 'select' && (
                        <>
                            {!noteId && (
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        value={sourceTitle}
                                        onChange={(e) => setSourceTitle(e.target.value)}
                                        placeholder={t('social.source_title_ph', "Title or topic (optional)")}
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    />
                                    <textarea
                                        value={sourceContent}
                                        onChange={(e) => setSourceContent(e.target.value)}
                                        rows={4}
                                        placeholder={t('social.source_content_ph', "Content you want to share…")}
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] resize-y"
                                    />
                                </div>
                            )}
                            {noteId && (
                                <p className="text-xs text-[var(--text-secondary)]/80">
                                    {t('social.from_record', { title: sourceTitle || '—', defaultValue: "Source: \"{{title}}\". AI will suggest a text for each network in the same language." })}
                                </p>
                            )}

                            <div>
                                <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                                    {t('social.pick_networks', "Networks to publish to")}
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    {networks.map((n) => {
                                        const on = selected.has(n.id);
                                        const disabled = n.configured === false;
                                        return (
                                            <label
                                                key={n.id}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                                                    disabled
                                                        ? 'opacity-50 cursor-not-allowed border-[var(--border-primary)]'
                                                        : on
                                                            ? 'bg-[var(--gnosi-primary)]/10 border-[var(--gnosi-primary)] text-[var(--gnosi-primary)] font-semibold cursor-pointer'
                                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] cursor-pointer'
                                                }`}
                                                title={disabled ? t('social.not_configured', "Not configured — connect it in Settings") : ''}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={on}
                                                    disabled={disabled || busy}
                                                    onChange={() => toggleNetwork(n.id)}
                                                    className="w-3.5 h-3.5"
                                                />
                                                <span>{n.icon}</span>
                                                <span className="flex-1">{n.name}</span>
                                                {disabled && <span className="text-[10px] uppercase text-[var(--text-tertiary)]">{t('social.off', "Off")}</span>}
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>

                            <input
                                type="text"
                                value={hint}
                                onChange={(e) => setHint(e.target.value)}
                                placeholder={t('social.hint_ph', "Instruction for the AI (optional): tone, emphasis…")}
                                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                            />
                        </>
                    )}

                    {step === 'compose' && (
                        <div className="space-y-3">
                            {selectedList.filter((net) => proposals[net] !== undefined).map((net) => {
                                const limit = charLimitFor(net);
                                const len = (drafts[net] || '').length;
                                const over = len > limit;
                                return (
                                    <div key={net} className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
                                        <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)]">
                                            <span className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                                                <span>{iconFor(net)}</span> {nameFor(net)}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[11px] tabular-nums ${over ? 'text-red-500 font-bold' : 'text-[var(--text-tertiary)]'}`}>
                                                    {len}/{limit}
                                                </span>
                                                <button
                                                    onClick={() => handleRegenerate(net)}
                                                    disabled={regeneratingNet === net || busy}
                                                    className="p-1 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] transition-colors disabled:opacity-50"
                                                    title={t('social.regenerate', "Regenerate")}
                                                >
                                                    {regeneratingNet === net
                                                        ? <Loader2 size={14} className="animate-spin" />
                                                        : <RefreshCw size={14} />}
                                                </button>
                                            </div>
                                        </div>
                                        <textarea
                                            value={drafts[net] || ''}
                                            onChange={(e) => setDrafts((prev) => ({ ...prev, [net]: e.target.value }))}
                                            rows={4}
                                            className={`w-full px-3 py-2 text-sm bg-[var(--bg-primary)] text-[var(--text-primary)] resize-y outline-none ${over ? 'border-t border-red-500/40' : ''}`}
                                        />
                                    </div>
                                );
                            })}

                            {overLimitNets.length > 0 && (
                                <p className="text-[11px] text-red-500 flex items-center gap-1">
                                    <AlertTriangle size={12} />
                                    {t('social.over_limit_hint', "Some text exceeds the limit. Shorten it before publishing.")}
                                </p>
                            )}

                            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                                <input type="checkbox" checked={scheduleOpen} onChange={(e) => setScheduleOpen(e.target.checked)} disabled={busy} />
                                {t('social.schedule_later', "Schedule for later")}
                            </label>
                            {scheduleOpen && (
                                <input
                                    type="datetime-local"
                                    value={scheduledAt}
                                    onChange={(e) => setScheduledAt(e.target.value)}
                                    disabled={busy}
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                />
                            )}
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-2 shrink-0">
                    {step === 'select' ? (
                        <>
                            <button
                                onClick={onClose}
                                disabled={busy}
                                className="px-4 py-2 border border-[var(--border-primary)] rounded-md text-sm font-bold text-[var(--text-secondary)]/80 hover:bg-[var(--bg-primary)] transition-colors disabled:opacity-50"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                onClick={handleGenerate}
                                disabled={busy || selected.size === 0}
                                className="btn-gnosi btn-gnosi-primary px-5 flex items-center gap-2 disabled:opacity-50"
                            >
                                {composing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                {t('social.generate', "Generate with AI")}
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => setStep('select')}
                                disabled={busy}
                                className="px-3 py-2 border border-[var(--border-primary)] rounded-md text-sm font-bold text-[var(--text-secondary)]/80 hover:bg-[var(--bg-primary)] transition-colors disabled:opacity-50 flex items-center gap-1"
                            >
                                <ArrowLeft size={14} /> {t('common.back', "Back")}
                            </button>
                            <button
                                onClick={scheduleOpen ? handleSchedule : handlePublish}
                                disabled={busy || overLimitNets.length > 0}
                                className="btn-gnosi btn-gnosi-primary px-5 flex items-center gap-2 disabled:opacity-50"
                            >
                                {publishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                {scheduleOpen ? t('social.schedule_submit', "Schedule") : t('social.publish_submit', "Publish now")}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// Derives reasonable content from a record's metadata when we cannot read
// the page body: title + the longest text field.
function deriveContent(meta) {
    if (!meta || typeof meta !== 'object') return '';
    const parts = [];
    if (meta.title) parts.push(String(meta.title));
    let longest = '';
    for (const [k, v] of Object.entries(meta)) {
        if (k === 'title') continue;
        if (typeof v === 'string' && v.length > longest.length) longest = v;
    }
    if (longest) parts.push(longest);
    return parts.join('\n\n').trim();
}

export default PublishSocialModal;
