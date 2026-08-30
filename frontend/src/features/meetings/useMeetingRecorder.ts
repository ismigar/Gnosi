import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import {
  announceFloatingPanelOpen,
  useExclusiveFloatingPanel,
} from '../../shared/hooks/useExclusiveFloatingPanel';
import { useFloatingActionDock } from '../../hooks/useFloatingActionDock';
import { toast } from '../../lib/toast';
import { vaultPath } from '../../lib/vaultRouting';
import {
  uploadMeetingRecording,
  type MeetingMode,
} from '../../shared/api/meeting-specialized';
import { fetchMeetingStatus } from '../../shared/api/meetings';


export type MeetingPhase =
  | 'idle'
  | 'recording'
  | 'uploading'
  | 'processing'
  | 'done'
  | 'error';


type CompatibleAudioWindow = Omit<Window, 'AudioContext'> & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};


type CompatibleNavigator = Omit<Navigator, 'mediaDevices'> & {
  mediaDevices?: MediaDevices;
};


export interface MeetingRecorderController {
  readonly closePanel: () => void;
  readonly errMsg: string;
  readonly mode: MeetingMode;
  readonly open: boolean;
  readonly openMinutes: () => void;
  readonly openPanel: () => void;
  readonly pageId: string | null;
  readonly phase: MeetingPhase;
  readonly reset: () => void;
  readonly retryUpload: () => void;
  readonly seconds: number;
  readonly setMode: (mode: MeetingMode) => void;
  readonly setTitle: (title: string) => void;
  readonly stageLabel: string;
  readonly startRecording: () => Promise<void>;
  readonly stopRecording: () => void;
  readonly title: string;
}


function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || 'Error';
  return typeof error === 'string' && error ? error : 'Error';
}


/** Own the browser media lifecycle and durable upload retry state. */
export function useMeetingRecorder(): MeetingRecorderController {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<MeetingPhase>('idle');
  const [mode, setMode] = useState<MeetingMode>('presencial');
  const [title, setTitle] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [stage, setStage] = useState('');
  const [pageId, setPageId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const [, setIsDockOpen] = useFloatingActionDock();
  useExclusiveFloatingPanel('meeting', open, setOpen);

  const navigate = useNavigate();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastBlobRef = useRef<Blob | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopTracks = useCallback((): void => {
    for (const stream of streamsRef.current) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamsRef.current = [];
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext) void audioContext.close().catch(() => undefined);
  }, []);

  const clearTimers = useCallback((): void => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    timerRef.current = null;
    pollRef.current = null;
  }, []);

  useEffect(() => () => {
    clearTimers();
    stopTracks();
  }, [clearTimers, stopTracks]);

  const pollStatus = useCallback((): void => {
    if (pollRef.current !== null) return;
    const checkStatus = async (): Promise<void> => {
      try {
        const data = await fetchMeetingStatus();
        setStage(data.stage);
        if (data.stage === 'done') {
          if (pollRef.current !== null) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setPageId(data.page_id ?? null);
          setPhase('done');
        } else if (data.stage === 'error') {
          if (pollRef.current !== null) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setErrMsg(data.error ?? t('meeting.error_processing'));
          setPhase('error');
        }
      } catch {
        // Processing may briefly be unavailable while the backend starts the job.
      }
    };
    pollRef.current = window.setInterval(() => {
      void checkStatus();
    }, 2_000);
  }, [t]);

  const upload = useCallback(async (blob: Blob): Promise<void> => {
    lastBlobRef.current = blob;
    setPhase('uploading');
    try {
      await uploadMeetingRecording(blob, title.trim() || 'Reunió', mode);
      lastBlobRef.current = null;
      setPhase('processing');
      setStage('transcribing');
      pollStatus();
    } catch (error: unknown) {
      setErrMsg(describeError(error));
      setPhase('error');
    }
  }, [mode, pollStatus, title]);

  const stopRecording = useCallback((): void => {
    const recorder = recorderRef.current;
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      stopTracks();
    }
  }, [stopTracks]);

  const startRecording = useCallback(async (): Promise<void> => {
    setErrMsg('');
    const mediaDevices = (navigator as CompatibleNavigator).mediaDevices;
    if (!mediaDevices || typeof MediaRecorder === 'undefined') {
      toast.error(t('meeting.no_audio_support'));
      return;
    }

    try {
      let recordStream: MediaStream;
      if (mode === 'online') {
        let display: MediaStream;
        try {
          display = await mediaDevices.getDisplayMedia({
            audio: true,
            video: true,
          });
        } catch {
          toast.error(t('meeting.share_screen_required'));
          return;
        }
        streamsRef.current.push(display);
        if (display.getAudioTracks().length === 0) {
          toast.error(t('meeting.no_audio_shared'));
          stopTracks();
          return;
        }

        let microphone: MediaStream | null = null;
        try {
          microphone = await mediaDevices.getUserMedia({ audio: true });
          streamsRef.current.push(microphone);
        } catch {
          // Shared audio remains usable when microphone permission is unavailable.
        }

        const compatibleWindow = window as CompatibleAudioWindow;
        const AudioContextConstructor = compatibleWindow.AudioContext
          ?? compatibleWindow.webkitAudioContext;
        if (!AudioContextConstructor) {
          toast.error(t('meeting.no_audio_support'));
          stopTracks();
          return;
        }
        const audioContext = new AudioContextConstructor();
        audioContextRef.current = audioContext;
        const destination = audioContext.createMediaStreamDestination();
        for (const stream of [display, microphone]) {
          if (stream && stream.getAudioTracks().length > 0) {
            audioContext.createMediaStreamSource(stream).connect(destination);
          }
        }
        for (const track of display.getVideoTracks()) {
          track.onended = stopRecording;
        }
        recordStream = destination.stream;
      } else {
        const microphone = await mediaDevices.getUserMedia({ audio: true });
        streamsRef.current.push(microphone);
        recordStream = microphone;
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = new MediaRecorder(
        recordStream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        clearTimers();
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size < 1_000) {
          setErrMsg(t('meeting.too_short'));
          setPhase('error');
          return;
        }
        void upload(blob);
      };
      recorderRef.current = recorder;
      recorder.start(1_000);
      setSeconds(0);
      setPhase('recording');
      timerRef.current = window.setInterval(
        () => {
          setSeconds((current) => current + 1);
        },
        1_000,
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'NotAllowedError') {
        toast.error(t('meeting.mic_denied'));
      } else {
        toast.error(t('meeting.start_error', { message: describeError(error) }));
      }
      stopTracks();
    }
  }, [clearTimers, mode, stopRecording, stopTracks, t, upload]);

  const reset = useCallback((): void => {
    clearTimers();
    stopTracks();
    lastBlobRef.current = null;
    setPhase('idle');
    setSeconds(0);
    setStage('');
    setPageId(null);
    setErrMsg('');
    setTitle('');
  }, [clearTimers, stopTracks]);

  const retryUpload = useCallback((): void => {
    if (lastBlobRef.current) void upload(lastBlobRef.current);
    else reset();
  }, [reset, upload]);

  const closePanel = useCallback((): void => {
    if (phase === 'recording') {
      toast.error(t('meeting.stop_before_close'));
      return;
    }
    if (phase === 'processing' || phase === 'uploading') {
      setOpen(false);
      return;
    }
    reset();
    setOpen(false);
  }, [phase, reset, t]);

  const openPanel = useCallback((): void => {
    announceFloatingPanelOpen('meeting');
    setIsDockOpen(false);
    setOpen(true);
  }, [setIsDockOpen]);

  const openMinutes = useCallback((): void => {
    if (pageId) void navigate(vaultPath('knowledge', `page/${pageId}`));
    reset();
    setOpen(false);
  }, [navigate, pageId, reset]);

  const stageLabel = stage === 'transcribing'
    ? t('meeting.stage_transcribing')
    : stage === 'summarizing'
      ? t('meeting.stage_summarizing')
      : stage === 'saving'
        ? t('meeting.stage_saving')
        : t('meeting.stage_processing');

  return {
    closePanel,
    errMsg,
    mode,
    open,
    openMinutes,
    openPanel,
    pageId,
    phase,
    reset,
    retryUpload,
    seconds,
    setMode,
    setTitle,
    stageLabel,
    startRecording,
    stopRecording,
    title,
  };
}
