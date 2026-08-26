import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Mic, Square, Loader2, X, FileText, Monitor, Users, AlertTriangle, Check } from 'lucide-react';
import { toast } from '../lib/toast';
import { announceFloatingPanelOpen, useExclusiveFloatingPanel } from '../hooks/useExclusiveFloatingPanel';
import { useFloatingActionDock } from '../hooks/useFloatingActionDock';
import { vaultPath } from '../lib/vaultRouting';

/**
 * AI meeting minutes taker (Notion AI Meeting Notes style).
 *
 * Global component (App.jsx). Records the meeting's audio:
 *  - In-person: microphone (captures the room).
 *  - Online: shared tab/screen audio (the others) + microphone,
 *    mixed with the Web Audio API.
 * On stop, it uploads the audio to `POST /api/meetings/record`; the backend transcribes it
 * LOCALLY (faster-whisper) and generates the MINUTES (AI) as a Vault page. The
 * component polls `/status` and offers to open the minutes.
 */
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function MeetingRecorder() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState('idle'); // idle|recording|uploading|processing|done|error
    const [mode, setMode] = useState('presencial'); // presencial|online
    const [title, setTitle] = useState('');
    const [seconds, setSeconds] = useState(0);
    const [stage, setStage] = useState('');
    const [pageId, setPageId] = useState(null);
    const [errMsg, setErrMsg] = useState('');
    const [, setIsDockOpen] = useFloatingActionDock();
    useExclusiveFloatingPanel('meeting', open, setOpen);

    const navigate = useNavigate();
    const recorderRef = useRef(null);
    const chunksRef = useRef([]);
    const lastBlobRef = useRef(null);   // retained so a failed upload can be retried
    const streamsRef = useRef([]);   // all MediaStreams to stop
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
                    setErrMsg(data.error || t('meeting.error_processing'));
                    setPhase('error');
                }
            } catch { /* segueix provant */ }
        }, 2000);
    }, [t]);

    const upload = useCallback(async (blob) => {
        // Retain the recording so a failed upload can be retried instead of lost.
        lastBlobRef.current = blob;
        setPhase('uploading');
        const fd = new FormData();
        fd.append('audio', blob, 'meeting.webm');
        fd.append('title', title.trim() || 'Reunió');
        fd.append('mode', mode);
        try {
            // timeout: 0 — a long meeting is a multi-MB upload that must not be
            // aborted by the global 30s axios timeout (which would discard the
            // recording). Pattern #812.
            await axios.post('/api/meetings/record', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 0,
            });
            lastBlobRef.current = null;  // uploaded successfully; drop the copy
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
            toast.error(t('meeting.no_audio_support'));
            return;
        }
        try {
            let recordStream;
            if (mode === 'online') {
                // Share tab/screen WITH audio + microphone, mixed.
                let display;
                try {
                    display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                } catch {
                    toast.error(t('meeting.share_screen_required'));
                    return;
                }
                streamsRef.current.push(display);
                if (!display.getAudioTracks().length) {
                    toast.error(t('meeting.no_audio_shared'));
                    stopTracks();
                    return;
                }
                let mic = null;
                try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); streamsRef.current.push(mic); } catch { /* without mic, tab only */ }
                const ac = new (window.AudioContext || window.webkitAudioContext)();
                audioCtxRef.current = ac;
                const dest = ac.createMediaStreamDestination();
                [display, mic].forEach((s) => { if (s && s.getAudioTracks().length) { try { ac.createMediaStreamSource(s).connect(dest); } catch { /* noop */ } } });
                // We don't need the video: stop it to save resources.
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
                if (blob.size < 1000) { setErrMsg(t('meeting.too_short')); setPhase('error'); return; }
                upload(blob);
            };
            recorderRef.current = rec;
            rec.start(1000);
            setSeconds(0);
            setPhase('recording');
            timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
        } catch (err) {
            if (err?.name === 'NotAllowedError') toast.error(t('meeting.mic_denied'));
            else toast.error(t('meeting.start_error', { message: String(err?.message || err) }));
            stopTracks();
        }
    }, [mode, upload, stopTracks, clearTimers, stopRecording, t]);

    const reset = useCallback(() => {
        clearTimers(); stopTracks();
        lastBlobRef.current = null;
        setPhase('idle'); setSeconds(0); setStage(''); setPageId(null); setErrMsg(''); setTitle('');
    }, [clearTimers, stopTracks]);

    const retryUpload = useCallback(() => {
        // Re-upload the retained recording instead of discarding it; fall back to
        // a full reset only if there is nothing to retry.
        if (lastBlobRef.current) {
            upload(lastBlobRef.current);
        } else {
            reset();
        }
    }, [upload, reset]);

    const closePanel = useCallback(() => {
        if (phase === 'recording') { toast.error(t('meeting.stop_before_close')); return; }
        if (phase === 'processing' || phase === 'uploading') { setOpen(false); return; } // segueix en segon pla
        reset(); setOpen(false);
    }, [phase, reset, t]);

    const stageLabel = stage === 'transcribing' ? t('meeting.stage_transcribing')
        : stage === 'summarizing' ? t('meeting.stage_summarizing')
        : stage === 'saving' ? t('meeting.stage_saving')
        : t('meeting.stage_processing');

    return (
        <>
            {/* Launcher (above the AgentChat button) */}
            {!open && (
                <button
                    type="button"
                    onClick={() => {
                        announceFloatingPanelOpen('meeting');
                        setIsDockOpen(false);
                        setOpen(true);
                    }}
                    title={t('meeting.launcher_title')}
                    aria-label={t('meeting.launcher_title')}
                    className="gnosi-floating-action gnosi-floating-action--meeting flex items-center justify-center rounded-full bg-[var(--gnosi-blue)] text-white shadow-sm transition hover:brightness-95"
                >
                    {phase === 'recording'
                        ? <span className="h-2.5 w-2.5 rounded-full bg-red-400 animate-pulse" />
                        : (phase === 'processing' || phase === 'uploading')
                            ? <Loader2 size={18} className="animate-spin" />
                            : <Mic size={18} />}
                </button>
            )}

            {open && (
                <div className="gnosi-floating-panel gnosi-floating-panel--meeting w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl">
                    <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
                        <Mic size={18} className="text-blue-500" />
                        <span className="font-medium">{t('meeting.panel_title')}</span>
                        <button type="button" onClick={closePanel} className="ml-auto rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]" aria-label={t('common.close')}>
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
                                    placeholder={t('meeting.title_placeholder')}
                                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-blue-500"
                                />
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: 'presencial', label: t('meeting.mode_in_person') },
                                        { id: 'online', label: t('meeting.mode_online') },
                                    ].map(({ id, label }) => (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => setMode(id)}
                                            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${mode === id ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-300' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                                        >
                                            {id === 'presencial' ? <Users size={15} /> : <Monitor size={15} />} {label}
                                        </button>
                                    ))}
                                </div>
                                <p className="flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
                                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                    {mode === 'online'
                                        ? t('meeting.online_hint')
                                        : t('meeting.in_person_hint')}
                                </p>
                                <button type="button" onClick={startRecording} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                                    <Mic size={16} /> {t('meeting.start')}
                                </button>
                            </>
                        )}

                        {phase === 'recording' && (
                            <div className="flex flex-col items-center gap-3 py-2">
                                <div className="flex items-center gap-2 text-red-500">
                                    <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                                    <span className="text-2xl font-mono tabular-nums">{fmt(seconds)}</span>
                                </div>
                                <div className="text-xs text-[var(--text-secondary)]">● {t('meeting.recording')} {mode === 'online' ? t('meeting.recording_online_suffix') : t('meeting.recording_mic_suffix')}</div>
                                <button type="button" onClick={stopRecording} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
                                    <Square size={15} /> {t('meeting.stop_generate')}
                                </button>
                            </div>
                        )}

                        {(phase === 'uploading' || phase === 'processing') && (
                            <div className="flex flex-col items-center gap-2 py-4 text-center">
                                <Loader2 size={22} className="animate-spin text-blue-500" />
                                <div className="text-sm">{phase === 'uploading' ? t('meeting.uploading') : stageLabel}</div>
                                <div className="text-xs text-[var(--text-secondary)]">{t('meeting.background_hint')}</div>
                            </div>
                        )}

                        {phase === 'done' && (
                            <div className="flex flex-col items-center gap-3 py-3 text-center">
                                <Check size={22} className="text-green-500" />
                                <div className="text-sm font-medium">{t('meeting.done')}</div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { if (pageId) navigate(vaultPath('knowledge', `page/${pageId}`)); reset(); setOpen(false); }}
                                        disabled={!pageId}
                                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        <FileText size={15} /> {t('meeting.open_minutes')}
                                    </button>
                                    <button type="button" onClick={reset} className="rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]">
                                        {t('meeting.new')}
                                    </button>
                                </div>
                            </div>
                        )}

                        {phase === 'error' && (
                            <div className="flex flex-col items-center gap-3 py-3 text-center">
                                <AlertTriangle size={22} className="text-amber-500" />
                                <div className="text-sm">{errMsg || t('meeting.generic_error')}</div>
                                <button type="button" onClick={retryUpload} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                                    {t('common.retry')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
