import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { X, BrainCircuit, Check, Trash2, Pencil, Loader2, Wand2, Mic, Square } from 'lucide-react';
import { toast } from '../../lib/toast';

// «Bústia del Cervell»: pending permanent-note suggestions. The AI only
// proposes — every card shows the question the note would answer, why the
// reading notes connect, and an editable draft. The user accepts (optionally
// edited) or rejects; accepting is the ONLY path that creates a permanent note.
export function BrainInbox({ onAccepted }) {
    const { t } = useTranslation();
    const tb = (k, def, opts) => t(`llm_wiki.inbox_${k}`, { defaultValue: def, ...(opts || {}) });
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState([]);
    const [busy, setBusy] = useState('');
    const [editing, setEditing] = useState(null); // {id, title, draft_md}
    // F6 accessible editing: pick-a-variant + dictation with intent proposal.
    const [variants, setVariants] = useState(null); // {id, list: [{label,text}]}
    const [variantsBusy, setVariantsBusy] = useState('');
    const [dictation, setDictation] = useState(null); // {id, recording|busy|proposal:{transcript,proposed,corrected}}
    const recorderRef = useRef(null);
    const chunksRef = useRef([]);
    useEffect(() => () => {
        // Unmount safety: stop mic tracks if a recording is in flight.
        try { recorderRef.current?.stream?.getTracks?.().forEach((tr) => tr.stop()); } catch { /* noop */ }
    }, []);

    const refresh = useCallback(() => {
        axios.get('/api/vault/llm-wiki/suggestions')
            .then((r) => setItems(Array.isArray(r.data?.suggestions) ? r.data.suggestions : []))
            .catch(() => setItems([]));
    }, []);
    useEffect(() => { refresh(); }, [refresh]);
    useEffect(() => { if (open) refresh(); }, [open, refresh]);

    const accept = async (sug, edited) => {
        setBusy(sug.id);
        try {
            const body = edited ? { title: edited.title, draft_md: edited.draft_md } : {};
            const { data } = await axios.post(
                `/api/vault/llm-wiki/suggestions/${encodeURIComponent(sug.id)}/accept`, body,
            );
            toast.success(tb('accepted', 'Nota permanent creada: {{title}}', { title: data?.title || sug.title }));
            setEditing(null);
            refresh();
            onAccepted?.();
        } catch (err) {
            toast.error(err.response?.data?.detail || tb('error', 'Error resolent el suggeriment'));
        } finally { setBusy(''); }
    };

    const reject = async (sug) => {
        setBusy(sug.id);
        try {
            await axios.post(`/api/vault/llm-wiki/suggestions/${encodeURIComponent(sug.id)}/reject`);
            refresh();
        } catch (err) {
            toast.error(err.response?.data?.detail || tb('error', 'Error resolent el suggeriment'));
        } finally { setBusy(''); }
    };

    // --- F6 level 1: labeled draft variants, picked with one click ---------
    const reformulate = async (sug) => {
        // Picking a variant edits the draft, so make sure we're in edit mode.
        if (editing?.id !== sug.id) {
            setEditing({ id: sug.id, title: sug.title, draft_md: sug.draft_md || '' });
        }
        setVariantsBusy(sug.id);
        setVariants(null);
        try {
            const { data } = await axios.post(
                `/api/vault/llm-wiki/suggestions/${encodeURIComponent(sug.id)}/reformulate`, {},
                { timeout: 120000 },
            );
            setVariants({ id: sug.id, list: data?.variants || [] });
        } catch (err) {
            toast.error(err.response?.data?.detail || tb('reformulate_error', 'No s\'han pogut generar variants'));
        } finally { setVariantsBusy(''); }
    };

    const pickVariant = (sug, variant) => {
        setEditing((cur) => ({
            id: sug.id,
            title: cur?.id === sug.id ? cur.title : sug.title,
            draft_md: variant.text,
        }));
        setVariants(null);
    };

    // --- F6 level 2: dictation → intent proposal («Volies dir…?») ----------
    const startDictation = async (sug) => {
        if (editing?.id !== sug.id) {
            setEditing({ id: sug.id, title: sug.title, draft_md: sug.draft_md || '' });
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
            const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
            chunksRef.current = [];
            rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
            rec.onstop = async () => {
                stream.getTracks().forEach((tr) => tr.stop());
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                setDictation({ id: sug.id, busy: true });
                try {
                    const fd = new FormData();
                    fd.append('audio', blob, 'dictation.webm');
                    const { data } = await axios.post(
                        `/api/vault/llm-wiki/suggestions/${encodeURIComponent(sug.id)}/dictate`, fd,
                        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 },
                    );
                    setDictation({ id: sug.id, proposal: data });
                } catch (err) {
                    setDictation(null);
                    toast.error(err.response?.data?.detail || tb('dictate_error', 'No s\'ha pogut processar el dictat'));
                }
            };
            recorderRef.current = rec;
            rec.start();
            setDictation({ id: sug.id, recording: true });
        } catch (err) {
            console.error('mic error:', err);
            toast.error(tb('mic_error', 'No s\'ha pogut accedir al micròfon'));
        }
    };

    const stopDictation = () => {
        try { recorderRef.current?.stop(); } catch { /* noop */ }
    };

    const applyDictation = (sug, mode) => {
        const prop = dictation?.proposal;
        if (!prop?.proposed) return;
        setEditing((cur) => {
            const base = cur?.id === sug.id ? cur : { id: sug.id, title: sug.title, draft_md: sug.draft_md || '' };
            const draft = mode === 'replace'
                ? prop.proposed
                : `${(base.draft_md || '').trim()}\n\n${prop.proposed}`.trim();
            return { ...base, draft_md: draft };
        });
        // Feed the personal glossary with the confirmed pair (the "intuition
        // component"): only when the corrector actually changed something.
        if (prop.corrected && prop.transcript && prop.transcript !== prop.proposed) {
            axios.post('/api/vault/llm-wiki/glossary', { heard: prop.transcript, meant: prop.proposed })
                .catch(() => { /* best-effort */ });
        }
        setDictation(null);
    };

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="relative flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                title={tb('button_title', 'Bústia del Cervell: suggeriments de notes permanents')}
            >
                <BrainCircuit size={15} />
                {tb('button', 'Bústia')}
                {items.length > 0 && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-[var(--gnosi-primary)] text-white text-[10px] font-bold flex items-center justify-center">
                        {items.length}
                    </span>
                )}
            </button>

            {open && (
                <div
                    className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
                >
                    <div
                        onMouseDown={(e) => e.stopPropagation()}
                        className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col border border-[var(--border-primary)]"
                    >
                        <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                            <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                                <BrainCircuit size={18} className="text-[var(--gnosi-primary)]" />
                                {tb('title', 'Bústia del Cervell')}
                                {items.length > 0 && <span className="text-xs font-semibold text-[var(--text-tertiary)]">({items.length})</span>}
                            </h2>
                            <button onClick={() => setOpen(false)} className="gnosi-close-btn" aria-label={t('common.close', 'Tanca')}>
                                <X />
                            </button>
                        </div>

                        <div className="p-5 space-y-4 overflow-y-auto">
                            {items.length === 0 && (
                                <p className="text-sm text-[var(--text-tertiary)]">
                                    {tb('empty', 'Cap suggeriment pendent. Es generen en processar recursos i en revisar el Cervell.')}
                                </p>
                            )}
                            {items.map((sug) => {
                                const isEditing = editing?.id === sug.id;
                                return (
                                    <div key={sug.id} className="rounded-lg border border-[var(--border-primary)] p-4 space-y-2">
                                        {sug.question && (
                                            <div className="text-sm font-bold text-[var(--text-primary)]">{sug.question}</div>
                                        )}
                                        {isEditing ? (
                                            <input
                                                className="gnosi-input w-full text-sm font-semibold"
                                                value={editing.title}
                                                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                                            />
                                        ) : (
                                            <div className="text-sm font-semibold text-[var(--gnosi-primary)]">{sug.title}</div>
                                        )}
                                        {sug.why && (
                                            <div className="text-xs text-[var(--text-secondary)] italic">{sug.why}</div>
                                        )}
                                        {isEditing ? (
                                            <textarea
                                                className="gnosi-input w-full text-xs leading-relaxed"
                                                rows={6}
                                                value={editing.draft_md}
                                                onChange={(e) => setEditing({ ...editing, draft_md: e.target.value })}
                                            />
                                        ) : (
                                            sug.draft_md && (
                                                <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed border-l-2 border-[var(--border-primary)] pl-3">
                                                    {sug.draft_md}
                                                </div>
                                            )
                                        )}
                                        {Array.isArray(sug.member_titles) && sug.member_titles.length > 0 && (
                                            <div className="text-[11px] text-[var(--text-tertiary)]">
                                                {tb('based_on', 'Basada en')}: {sug.member_titles.join(' · ')}
                                            </div>
                                        )}

                                        {variants?.id === sug.id && variants.list.length > 0 && (
                                            <div className="space-y-2 pt-1">
                                                <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
                                                    {tb('variants_title', 'Tria una variant')}
                                                </div>
                                                {variants.list.map((v, i) => (
                                                    <button
                                                        key={i}
                                                        onClick={() => pickVariant(sug, v)}
                                                        className="w-full text-left rounded-md border border-[var(--border-primary)] p-2.5 hover:border-[var(--gnosi-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                                    >
                                                        <div className="text-[11px] font-bold text-[var(--gnosi-primary)] mb-1">{v.label}</div>
                                                        <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{v.text}</div>
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {dictation?.id === sug.id && dictation.busy && (
                                            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] pt-1">
                                                <Loader2 size={14} className="animate-spin text-[var(--gnosi-primary)]" />
                                                {tb('dictate_processing', 'Escoltant la intenció del dictat…')}
                                            </div>
                                        )}
                                        {dictation?.id === sug.id && dictation.proposal && (
                                            <div className="rounded-md border border-[var(--gnosi-primary)]/40 bg-[var(--bg-secondary)] p-3 space-y-2">
                                                <div className="text-[11px] text-[var(--text-tertiary)]">
                                                    {tb('dictate_heard', 'He sentit')}: «{dictation.proposal.transcript}»
                                                </div>
                                                <div className="text-xs font-semibold text-[var(--text-primary)]">
                                                    {tb('dictate_meant', 'Volies dir')}:
                                                </div>
                                                <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
                                                    {dictation.proposal.proposed}
                                                </div>
                                                <div className="flex items-center gap-2 pt-1">
                                                    <button
                                                        onClick={() => applyDictation(sug, 'append')}
                                                        className="px-2.5 py-1 rounded-md text-[11px] font-bold text-white bg-[var(--gnosi-primary)] hover:opacity-90"
                                                    >
                                                        {tb('dictate_append', 'Afegeix al final')}
                                                    </button>
                                                    <button
                                                        onClick={() => applyDictation(sug, 'replace')}
                                                        className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-[var(--text-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-primary)]"
                                                    >
                                                        {tb('dictate_replace', 'Substitueix l\'esborrany')}
                                                    </button>
                                                    <button
                                                        onClick={() => setDictation(null)}
                                                        className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-red-500 hover:bg-red-500/10"
                                                    >
                                                        {tb('dictate_discard', 'Descarta')}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex items-center gap-2 pt-1">
                                            <button
                                                onClick={() => accept(sug, isEditing ? editing : null)}
                                                disabled={busy === sug.id}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold text-white bg-[var(--gnosi-primary)] hover:opacity-90 disabled:opacity-50"
                                            >
                                                {busy === sug.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                                {isEditing ? tb('accept_edited', 'Accepta amb canvis') : tb('accept', 'Accepta')}
                                            </button>
                                            <button
                                                onClick={() => setEditing(isEditing ? null : { id: sug.id, title: sug.title, draft_md: sug.draft_md || '' })}
                                                disabled={busy === sug.id}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold text-[var(--text-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                                            >
                                                <Pencil size={13} />
                                                {isEditing ? tb('cancel_edit', 'Descarta canvis') : tb('edit', 'Edita')}
                                            </button>
                                            <button
                                                onClick={() => reject(sug)}
                                                disabled={busy === sug.id}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold text-red-500 border border-red-500/30 hover:bg-red-500/10 disabled:opacity-50"
                                            >
                                                <Trash2 size={13} />
                                                {tb('reject', 'Rebutja')}
                                            </button>
                                            <span className="flex-1" />
                                            <button
                                                onClick={() => reformulate(sug)}
                                                disabled={variantsBusy === sug.id || busy === sug.id}
                                                title={tb('reformulate_title', 'Genera variants de l\'esborrany per triar-ne una')}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/30 hover:bg-[var(--gnosi-primary)]/10 disabled:opacity-50"
                                            >
                                                {variantsBusy === sug.id ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                                                {tb('reformulate', 'Reformula')}
                                            </button>
                                            {dictation?.id === sug.id && dictation.recording ? (
                                                <button
                                                    onClick={stopDictation}
                                                    title={tb('dictate_stop', 'Atura i processa el dictat')}
                                                    className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold text-white bg-red-500 hover:bg-red-600 animate-pulse"
                                                >
                                                    <Square size={13} />
                                                    {tb('dictate_stop_short', 'Atura')}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => startDictation(sug)}
                                                    disabled={busy === sug.id || (dictation?.id === sug.id && dictation.busy)}
                                                    title={tb('dictate_title', 'Dicta un matís; et proposaré què volies dir abans d\'aplicar res')}
                                                    className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/30 hover:bg-[var(--gnosi-primary)]/10 disabled:opacity-50"
                                                >
                                                    <Mic size={13} />
                                                    {tb('dictate', 'Dicta')}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
