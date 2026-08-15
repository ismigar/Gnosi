import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const INITIAL_STATE = { status: 'idle' };

export function DesktopUpdateNotice() {
    const { t } = useTranslation();
    const [update, setUpdate] = useState(INITIAL_STATE);
    const [dismissedVersion, setDismissedVersion] = useState(null);
    const eventSequence = useRef(0);

    useEffect(() => {
        const api = window.electronAPI;
        if (!api?.onUpdateStatus || !api?.getUpdateStatus) return undefined;

        const initialSequence = eventSequence.current;
        api.onUpdateStatus((nextUpdate) => {
            eventSequence.current += 1;
            setUpdate(nextUpdate);
        });

        api.getUpdateStatus()
            .then((currentUpdate) => {
                if (eventSequence.current === initialSequence && currentUpdate) {
                    setUpdate(currentUpdate);
                }
            })
            .catch(() => {});

        return () => api.removeUpdateListener?.();
    }, []);

    const version = update.version || '';
    const visibleStatuses = ['available', 'downloading', 'downloaded', 'manual-download'];
    const isVisible = (visibleStatuses.includes(update.status)
        || (update.status === 'error' && update.userInitiated))
        && dismissedVersion !== version;

    if (!isVisible) return null;

    const percent = Math.max(0, Math.min(100, Math.round(update.percent || 0)));

    const downloadUpdate = () => {
        window.electronAPI?.downloadUpdate?.().then((nextUpdate) => {
            if (nextUpdate) setUpdate(nextUpdate);
        }).catch(() => {
            setUpdate((current) => ({ ...current, status: 'error', userInitiated: true }));
        });
    };

    const installUpdate = () => {
        window.electronAPI?.installUpdate?.().then((nextUpdate) => {
            if (nextUpdate) setUpdate(nextUpdate);
        }).catch(() => {
            setUpdate((current) => ({ ...current, status: 'error', userInitiated: true }));
        });
    };

    return (
        <aside
            className="fixed right-4 top-4 z-[var(--z-toast)] w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-[var(--text-primary)] shadow-lg"
            role="status"
            aria-live="polite"
            aria-label={t('desktop_update.aria_label', 'Application update')}
        >
            <button
                type="button"
                onClick={() => setDismissedVersion(version)}
                className="absolute right-2 top-2 rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                aria-label={t('desktop_update.dismiss', 'Dismiss update notice')}
            >
                <X size={15} aria-hidden="true" />
            </button>

            <div className="flex gap-2.5 pr-6">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-primary)] text-white">
                    {update.status === 'downloaded'
                        ? <RefreshCw size={16} aria-hidden="true" />
                        : <Download size={16} aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">
                        {update.status === 'downloaded'
                            ? t('desktop_update.ready_title', 'Update ready')
                            : update.status === 'manual-download'
                                ? t('desktop_update.manual_title', 'Installer download started')
                                : update.status === 'error'
                                    ? t('desktop_update.error_title', 'Update could not be completed')
                                    : t('desktop_update.available_title', 'Gnosi {{version}} is available', { version })}
                    </h2>
                    {update.status !== 'available' && <p className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">
                        {update.status === 'downloading'
                            && t('desktop_update.downloading_body', 'Downloading version {{version}}… {{percent}}%', { version, percent })}
                        {update.status === 'downloaded'
                            && t('desktop_update.ready_body', 'Restart Gnosi to finish installing version {{version}}.', { version })}
                        {update.status === 'manual-download'
                            && t('desktop_update.manual_body', 'Open the DMG when the download finishes.')}
                        {update.status === 'error'
                            && t('desktop_update.error_body', 'Please try the update again later.')}
                    </p>}

                    {update.status === 'downloading' && (
                        <div
                            className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]"
                            role="progressbar"
                            aria-valuemin="0"
                            aria-valuemax="100"
                            aria-valuenow={percent}
                        >
                            <div
                                className="h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-200"
                                style={{ width: `${percent}%` }}
                            />
                        </div>
                    )}

                    {update.status === 'available' && (
                        <div className="mt-2">
                            <button
                                type="button"
                                onClick={downloadUpdate}
                                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-primary)] px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                            >
                                <Download size={14} aria-hidden="true" />
                                {t('desktop_update.download', 'Download')}
                            </button>
                        </div>
                    )}

                    {update.status === 'downloaded' && (
                        <button
                            type="button"
                            onClick={installUpdate}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-primary)] px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                        >
                            <RefreshCw size={14} aria-hidden="true" />
                            {t('desktop_update.restart', 'Restart and install')}
                        </button>
                    )}
                </div>
            </div>
        </aside>
    );
}
