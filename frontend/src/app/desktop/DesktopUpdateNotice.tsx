import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const INITIAL_STATE: DesktopUpdateState = { status: 'idle' };
const VISIBLE_STATUSES: ReadonlySet<DesktopUpdateStatus> = new Set([
    'available', 'downloading', 'downloaded', 'installing', 'manual-download',
]);

export function DesktopUpdateNotice() {
    const { t } = useTranslation();
    const [update, setUpdate] = useState<DesktopUpdateState>(INITIAL_STATE);
    const eventSequence = useRef(0);
    const actionPending = useRef(false);

    useEffect(() => {
        const api = window.electronAPI;
        if (!api?.onUpdateStatus || !api.getUpdateStatus) return undefined;
        let active = true;
        const initialSequence = eventSequence.current;
        const dispose = api.onUpdateStatus((nextUpdate) => {
            eventSequence.current += 1;
            if (active) setUpdate(nextUpdate);
        });
        void api.getUpdateStatus().then((currentUpdate) => {
            if (active && eventSequence.current === initialSequence && currentUpdate) {
                setUpdate(currentUpdate);
            }
        }).catch(() => undefined);
        return () => {
            active = false;
            if (dispose) dispose();
            else api.removeUpdateListener?.();
        };
    }, []);

    const isError = update.status === 'error' && update.userInitiated;
    if (!VISIBLE_STATUSES.has(update.status) && !isError) return null;

    const version = update.version ?? '';
    const percent = Number.isFinite(update.percent)
        ? Math.max(0, Math.min(100, Math.floor(update.percent ?? 0))) : 0;
    const downloading = update.status === 'downloading';
    const installing = update.status === 'installing';
    const manual = update.status === 'manual-download';
    const busy = downloading || installing;
    const label = downloading
        ? t('desktop_update.progress', 'Downloaded {{percent}}%', { percent })
        : installing
            ? t('desktop_update.installing', 'Restarting…')
            : manual
                ? t('desktop_update.manual_action', 'Open the installer')
                : update.status === 'downloaded'
                    ? t('desktop_update.restart', 'Restart and install')
                    : isError
                        ? t('desktop_update.retry', 'Retry update')
                        : t('desktop_update.update', 'Update Gnosi');
    const description = isError
        ? t('desktop_update.error_title', 'Update could not be completed')
        : manual || update.installMode === 'manual'
            ? t('desktop_update.manual_body', 'Open the DMG when the download finishes.')
            : t('desktop_update.automatic_hint', 'Download version {{version}} and restart automatically when ready.', { version });

    const runAction = async (): Promise<void> => {
        if (actionPending.current || busy || manual) return;
        const action = update.status === 'downloaded'
            ? window.electronAPI?.installUpdate : window.electronAPI?.downloadUpdate;
        if (!action) return;
        actionPending.current = true;
        const sequence = eventSequence.current;
        setUpdate((current) => ({ ...current, status: update.status === 'downloaded' ? 'installing' : 'downloading', percent: 0, userInitiated: true }));
        try {
            const nextUpdate = await action();
            if (nextUpdate && eventSequence.current === sequence) setUpdate(nextUpdate);
        } catch {
            setUpdate((current) => ({ ...current, status: 'error', userInitiated: true }));
        } finally {
            actionPending.current = false;
        }
    };

    return (
        <aside
            className="fixed bottom-4 left-4 z-[var(--z-toast)] max-w-[calc(100vw-2rem)] md:left-[calc(var(--app-sidebar-width)+1rem)]"
            aria-label={t('desktop_update.aria_label', 'Application update')}
        >
            <button
                type="button"
                onClick={() => { void runAction(); }}
                disabled={busy || manual}
                title={description}
                aria-label={`${label}. ${description}`}
                aria-busy={busy}
                className="relative inline-flex min-h-9 items-center gap-2 overflow-hidden rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] disabled:cursor-default"
            >
                {installing || update.status === 'downloaded'
                    ? <RefreshCw size={14} className={installing ? 'motion-safe:animate-spin' : undefined} aria-hidden="true" />
                    : <Download size={14} aria-hidden="true" />}
                <span role="status" aria-live="polite" aria-atomic="true">{label}</span>
                {downloading && (
                    <span
                        className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--bg-secondary)]"
                        role="progressbar"
                        aria-label={t('desktop_update.aria_label', 'Application update')}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                    >
                        <span className="block h-full bg-[var(--accent-primary)] motion-safe:transition-[width]" style={{ width: `${String(percent)}%` }} />
                    </span>
                )}
            </button>
        </aside>
    );
}
