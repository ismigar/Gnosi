import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { findRelease } from '../lib/releaseNotes';
import { ReleaseNotesDialog } from './ReleaseNotesDialog';

const INITIAL_STATE = { status: 'idle' };

export function DesktopUpdateNotice() {
    const { t } = useTranslation();
    const [update, setUpdate] = useState(INITIAL_STATE);
    const [dismissedVersion, setDismissedVersion] = useState(null);
    const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
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
    const isVisible = ['available', 'downloading', 'downloaded'].includes(update.status)
        && !(update.status === 'available' && dismissedVersion === version);

    if (!isVisible && !releaseNotesOpen) return null;

    const percent = Math.max(0, Math.min(100, Math.round(update.percent || 0)));

    const downloadUpdate = () => {
        window.electronAPI?.downloadUpdate?.().catch(() => {});
    };

    const installUpdate = () => {
        window.electronAPI?.installUpdate?.().catch(() => {});
    };

    return (
        <>
        {isVisible && <aside
            className="fixed right-5 top-5 z-[var(--z-toast)] w-[min(24rem,calc(100vw-2.5rem))] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 text-[var(--text-primary)] shadow-2xl"
            role="status"
            aria-live="polite"
            aria-label={t('desktop_update.aria_label', 'Application update')}
        >
            {update.status === 'available' && (
                <button
                    type="button"
                    onClick={() => setDismissedVersion(version)}
                    className="absolute right-3 top-3 rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                    aria-label={t('desktop_update.dismiss', 'Dismiss update notice')}
                >
                    <X size={17} aria-hidden="true" />
                </button>
            )}

            <div className="flex gap-3 pr-7">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-primary)] text-white">
                    {update.status === 'downloaded'
                        ? <RefreshCw size={18} aria-hidden="true" />
                        : <Download size={18} aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">
                        {update.status === 'downloaded'
                            ? t('desktop_update.ready_title', 'Update ready')
                            : t('desktop_update.available_title', 'A new Gnosi version is available')}
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                        {update.status === 'available'
                            && t('desktop_update.available_body', 'Version {{version}} is ready to download.', { version })}
                        {update.status === 'downloading'
                            && t('desktop_update.downloading_body', 'Downloading version {{version}}… {{percent}}%', { version, percent })}
                        {update.status === 'downloaded'
                            && t('desktop_update.ready_body', 'Restart Gnosi to finish installing version {{version}}.', { version })}
                    </p>

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
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={downloadUpdate}
                                className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-primary)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                            >
                                <Download size={15} aria-hidden="true" />
                                {t('desktop_update.download', 'Download update')}
                            </button>
                            {findRelease(version) && (
                                <button
                                    type="button"
                                    onClick={() => setReleaseNotesOpen(true)}
                                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-primary)] px-3 py-2 text-xs font-semibold hover:bg-[var(--bg-secondary)]"
                                >
                                    <Sparkles size={15} aria-hidden="true" />
                                    {t('desktop_update.whats_new', "What's new")}
                                </button>
                            )}
                        </div>
                    )}

                    {update.status === 'downloaded' && (
                        <button
                            type="button"
                            onClick={installUpdate}
                            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[var(--accent-primary)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                        >
                            <RefreshCw size={15} aria-hidden="true" />
                            {t('desktop_update.restart', 'Restart and install')}
                        </button>
                    )}
                </div>
            </div>
        </aside>}
        <ReleaseNotesDialog
            open={releaseNotesOpen}
            onClose={() => setReleaseNotesOpen(false)}
            initialVersion={version}
        />
        </>
    );
}
