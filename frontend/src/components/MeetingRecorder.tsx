import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  Mic,
  Monitor,
  Square,
  Users,
  X,
} from 'lucide-react';

import type { MeetingMode } from '../shared/api/meeting-specialized';
import { useMeetingRecorder } from './useMeetingRecorder';


function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}


/** Render the global AI meeting recorder panel. */
export default function MeetingRecorder() {
  const { t } = useTranslation();
  const recorder = useMeetingRecorder();
  const modes: ReadonlyArray<{ id: MeetingMode; label: string }> = [
    { id: 'presencial', label: t('meeting.mode_in_person') },
    { id: 'online', label: t('meeting.mode_online') },
  ];

  return (
    <>
      {!recorder.open && (
        <button
          type="button"
          onClick={recorder.openPanel}
          title={t('meeting.launcher_title')}
          aria-label={t('meeting.launcher_title')}
          className="gnosi-floating-action gnosi-floating-action--meeting flex items-center justify-center rounded-full bg-[var(--gnosi-blue)] text-white shadow-sm transition hover:brightness-95"
        >
          {recorder.phase === 'recording'
            ? <span className="h-2.5 w-2.5 rounded-full bg-red-400 animate-pulse" />
            : recorder.phase === 'processing' || recorder.phase === 'uploading'
              ? <Loader2 size={18} className="animate-spin" />
              : <Mic size={18} />}
        </button>
      )}

      {recorder.open && (
        <div className="gnosi-floating-panel gnosi-floating-panel--meeting w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
            <Mic size={18} className="text-blue-500" />
            <span className="font-medium">{t('meeting.panel_title')}</span>
            <button
              type="button"
              onClick={recorder.closePanel}
              className="ml-auto rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3 p-4">
            {recorder.phase === 'idle' && (
              <>
                <input
                  type="text"
                  value={recorder.title}
                  onChange={(event) => {
                    recorder.setTitle(event.target.value);
                  }}
                  placeholder={t('meeting.title_placeholder')}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                <div className="grid grid-cols-2 gap-2">
                  {modes.map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        recorder.setMode(id);
                      }}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${recorder.mode === id ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-300' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                    >
                      {id === 'presencial'
                        ? <Users size={15} />
                        : <Monitor size={15} />}
                      {label}
                    </button>
                  ))}
                </div>
                <p className="flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  {recorder.mode === 'online'
                    ? t('meeting.online_hint')
                    : t('meeting.in_person_hint')}
                </p>
                <button
                  type="button"
                  onClick={() => void recorder.startRecording()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Mic size={16} />
                  {t('meeting.start')}
                </button>
              </>
            )}

            {recorder.phase === 'recording' && (
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="flex items-center gap-2 text-red-500">
                  <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-2xl font-mono tabular-nums">
                    {formatDuration(recorder.seconds)}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  ● {t('meeting.recording')}{' '}
                  {recorder.mode === 'online'
                    ? t('meeting.recording_online_suffix')
                    : t('meeting.recording_mic_suffix')}
                </div>
                <button
                  type="button"
                  onClick={recorder.stopRecording}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  <Square size={15} />
                  {t('meeting.stop_generate')}
                </button>
              </div>
            )}

            {(recorder.phase === 'uploading' || recorder.phase === 'processing') && (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <Loader2 size={22} className="animate-spin text-blue-500" />
                <div className="text-sm">
                  {recorder.phase === 'uploading'
                    ? t('meeting.uploading')
                    : recorder.stageLabel}
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {t('meeting.background_hint')}
                </div>
              </div>
            )}

            {recorder.phase === 'done' && (
              <div className="flex flex-col items-center gap-3 py-3 text-center">
                <Check size={22} className="text-green-500" />
                <div className="text-sm font-medium">{t('meeting.done')}</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={recorder.openMinutes}
                    disabled={!recorder.pageId}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <FileText size={15} />
                    {t('meeting.open_minutes')}
                  </button>
                  <button
                    type="button"
                    onClick={recorder.reset}
                    className="rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                  >
                    {t('meeting.new')}
                  </button>
                </div>
              </div>
            )}

            {recorder.phase === 'error' && (
              <div className="flex flex-col items-center gap-3 py-3 text-center">
                <AlertTriangle size={22} className="text-amber-500" />
                <div className="text-sm">
                  {recorder.errMsg || t('meeting.generic_error')}
                </div>
                <button
                  type="button"
                  onClick={recorder.retryUpload}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
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
