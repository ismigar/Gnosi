import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Mic, Square, Loader2, X, FileText, Monitor, Users, AlertTriangle, Check } from 'lucide-react';
import { toast } from '../lib/toast';

/**
 * Prenedor d'actes de reunions amb IA (estil Notion AI Meeting Notes).
 *
 * Component global (App.jsx). Grava l'àudio de la reunió:
 *  - Presencial: micròfon (capta la sala).
 *  - Online: àudio de la pestanya/pantalla compartida (els altres) + micròfon,
 *    barrejats amb Web Audio API.
 * En aturar, puja l'àudio a `POST /api/meetings/record`; el backend el transcriu
 * LOCALMENT (faster-whisper) i en genera l'ACTA (IA) com a pàgina del Vault. El
 * component fa polling de `/status` i ofereix obrir l'acta.
 */
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function MeetingRecorder() {
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState('idle'); // idle|recording|uploading|processing|done|error
    const [mode, setMode] = useState('presencial'); // presencial|online
    const [title, setTitle] = useState('');
    const [seconds, setSeconds] = useState(0);
    const [stage, setStage] = useState('');
    const [pageId, setPageId] = useState(null);
    const [errMsg, setErrMsg] = useState('');

    const navigate = useNavigate();
    const recorderRef = useRef(null);
    const chunksRef = useRef([]);
    const streamsRef = useRef([]);   // tots els MediaStream a aturar
    const audioCtxRef = useRef(null);
    const timerRef = useRef(null);
    const pollRef = useRef(null);

    const stopTracks = useCallback(() => {
        streamsRef.current.forEach((s) => { try { s.getTracks().forEach((t) => t.stop()); } catch { /* noop */ } });
        streamsRef.current = [];
        if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* noop */ } audioCtxRef.current = null; }
    }, []);

    const clearTimers = useCallback(() => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }, []);

    // Neteja en desmuntar.
    useEffect(() => () => { clearTimers(); stopTracks(); }, [clearTimers, stopTracks]);

    const pollStatus = useCallback(() => {
        if (pollRef.current) return;
        pollRef.current = setInterval(async () => {
            try {
                const { data } = await axios.get('/api/meetings/status');
                setStage(data?.stage || '');
                if (data?.stage === 'done') {
                    clearInterval(pollRef.current); pollRef.current = null;
                    setPageId(data.page_id || null);
                    setPhase('done');
                } else if (data?.stage === 'error') {
                    clearInterval(pollRef.current); pollRef.current = null;
                    setErrMsg(data.error || 'Error processant la reunió');
                    setPhase('error');
                }
            } catch { /* segueix provant */ }
        }, 2000);
    }, []);

    const upload = useCallback(async (blob) => {
        setPhase('uploading');
        const fd = new FormData();
        fd.append('audio', blob, 'meeting.webm');
        fd.append('title', title.trim() || 'Reunió');
        fd.append('mode', mode);
        try {
            await axios.post('/api/meetings/record', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            setPhase('processing');
            setStage('transcribing');
            pollStatus();
        } catch (err) {
            const detail = err?.response?.data?.detail || err?.message || 'Error';
            setErrMsg(detail);
            setPhase('error');
        }
    }, [title, mode, pollStatus]);

    const stopRecording = useCallback(() => {
        try { if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop(); }
        catch { stopTracks(); }
    }, [stopTracks]);

    const startRecording = useCallback(async () => {
        setErrMsg('');
        if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
            toast.error('Aquest navegador no suporta gravació d\'àudio.');
            return;
        }
        try {
            let recordStream;
            if (mode === 'online') {
                // Comparteix pestanya/pantalla AMB àudio + micròfon, barrejats.
                let display;
                try {
                    display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                } catch {
                    toast.error('Cal compartir una pestanya o pantalla (amb la casella d\'àudio marcada).');
                    return;
                }
                streamsRef.current.push(display);
                if (!display.getAudioTracks().length) {
                    toast.error('No has compartit l\'àudio. En compartir, marca «Compartir àudio de la pestanya».');
                    stopTracks();
                    return;
                }
                let mic = null;
                try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); streamsRef.current.push(mic); } catch { /* sense micro, només pestanya */ }
                const ac = new (window.AudioContext || window.webkitAudioContext)();
                audioCtxRef.current = ac;
                const dest = ac.createMediaStreamDestination();
                [display, mic].forEach((s) => { if (s && s.getAudioTracks().length) { try { ac.createMediaStreamSource(s).connect(dest); } catch { /* noop */ } } });
                // No necessitem el vídeo: atura'l per estalviar recursos.
                display.getVideoTracks().forEach((t) => { t.onended = () => stopRecording(); });
                recordStream = dest.stream;
            } else {
                const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
                streamsRef.current.push(mic);
                recordStream = mic;
            }

            const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
            const rec = new MediaRecorder(recordStream, mime ? { mimeType: mime } : undefined);
            chunksRef.current = [];
            rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
            rec.onstop = () => {
                clearTimers();
                stopTracks();
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                if (blob.size < 1000) { setErrMsg('Gravació massa curta o buida.'); setPhase('error'); return; }
                upload(blob);
            };
            recorderRef.current = rec;
            rec.start(1000);
            setSeconds(0);
            setPhase('recording');
            timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
        } catch (err) {
            if (err?.name === 'NotAllowedError') toast.error('Permís de micròfon denegat.');
            else toast.error(`No s'ha pogut iniciar la gravació: ${err?.message || err}`);
            stopTracks();
        }
    }, [mode, upload, stopTracks, clearTimers, stopRecording]);

    const reset = useCallback(() => {
        clearTimers(); stopTracks();
        setPhase('idle'); setSeconds(0); setStage(''); setPageId(null); setErrMsg(''); setTitle('');
    }, [clearTimers, stopTracks]);

    const closePanel = useCallback(() => {
        if (phase === 'recording') { toast.error('Atura la gravació abans de tancar.'); return; }
        if (phase === 'processing' || phase === 'uploading') { setOpen(false); return; } // segueix en segon pla
        reset(); setOpen(false);
    }, [phase, reset]);

    const stageLabel = stage === 'transcribing' ? 'Transcrivint l\'àudio…'
        : stage === 'summarizing' ? 'Generant l\'acta amb IA…'
        : stage === 'saving' ? 'Desant la pàgina…'
        : 'Processant…';

    return (
        <>
            {/* Launcher (sobre el botó d'AgentChat) */}
            {!open && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    title="Acta de reunió amb IA"
                    className="fixed right-6 bottom-24 z-[99998] flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg hover:bg-violet-700"
                >
                    {phase === 'recording'
                        ? <span className="h-3 w-3 rounded-full bg-red-400 animate-pulse" />
                        : (phase === 'processing' || phase === 'uploading')
                            ? <Loader2 size={20} className="animate-spin" />
                            : <Mic size={20} />}
                </button>
            )}

            {open && (
                <div className="fixed right-6 bottom-6 z-[99998] w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl">
                    <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
                        <Mic size={18} className="text-violet-500" />
                        <span className="font-medium">Acta de reunió</span>
                        <button type="button" onClick={closePanel} className="ml-auto rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]" aria-label="Tanca">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="space-y-3 p-4">
                        {phase === 'idle' && (
                            <>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Títol de la reunió (opcional)"
                                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-violet-500"
                                />
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: 'presencial', label: 'Presencial' },
                                        { id: 'online', label: 'Online' },
                                    ].map(({ id, label }) => (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => setMode(id)}
                                            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${mode === id ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-300' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                                        >
                                            {id === 'presencial' ? <Users size={15} /> : <Monitor size={15} />} {label}
                                        </button>
                                    ))}
                                </div>
                                <p className="flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
                                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                    {mode === 'online'
                                        ? 'Hauràs de compartir la pestanya/pantalla amb la casella «Compartir àudio» marcada. Avisa els participants que graves.'
                                        : 'Es gravarà pel micròfon. Avisa els participants que graves.'}
                                </p>
                                <button type="button" onClick={startRecording} className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
                                    <Mic size={16} /> Comença a gravar
                                </button>
                            </>
                        )}

                        {phase === 'recording' && (
                            <div className="flex flex-col items-center gap-3 py-2">
                                <div className="flex items-center gap-2 text-red-500">
                                    <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                                    <span className="text-2xl font-mono tabular-nums">{fmt(seconds)}</span>
                                </div>
                                <div className="text-xs text-[var(--text-secondary)]">● Gravant {mode === 'online' ? '(pantalla + micro)' : '(micròfon)'}</div>
                                <button type="button" onClick={stopRecording} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
                                    <Square size={15} /> Atura i genera l'acta
                                </button>
                            </div>
                        )}

                        {(phase === 'uploading' || phase === 'processing') && (
                            <div className="flex flex-col items-center gap-2 py-4 text-center">
                                <Loader2 size={22} className="animate-spin text-violet-500" />
                                <div className="text-sm">{phase === 'uploading' ? 'Pujant l\'àudio…' : stageLabel}</div>
                                <div className="text-xs text-[var(--text-secondary)]">Pots tancar aquest tauler; continua en segon pla.</div>
                            </div>
                        )}

                        {phase === 'done' && (
                            <div className="flex flex-col items-center gap-3 py-3 text-center">
                                <Check size={22} className="text-green-500" />
                                <div className="text-sm font-medium">Acta generada</div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { if (pageId) navigate(`/vault/page/${pageId}`); reset(); setOpen(false); }}
                                        disabled={!pageId}
                                        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                                    >
                                        <FileText size={15} /> Obre l'acta
                                    </button>
                                    <button type="button" onClick={reset} className="rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]">
                                        Nova
                                    </button>
                                </div>
                            </div>
                        )}

                        {phase === 'error' && (
                            <div className="flex flex-col items-center gap-3 py-3 text-center">
                                <AlertTriangle size={22} className="text-amber-500" />
                                <div className="text-sm">{errMsg || 'Hi ha hagut un error.'}</div>
                                <button type="button" onClick={reset} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
                                    Torna-ho a provar
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
