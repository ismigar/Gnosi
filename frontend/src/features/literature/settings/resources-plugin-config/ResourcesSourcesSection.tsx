import {
    EyeOff,
    KeyRound,
    Loader2,
    Pencil,
    Play,
    Plus,
    RefreshCw,
    RotateCcw,
    Search,
    Square,
    Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    sourceCompleteListSize,
    sourceGroup,
    sourceHasCredential,
    sourceLastSuccessfulDatestamp,
    statusLabel,
    synchronizationActive,
} from './resourcesPluginConfigModel';
import type { ResourcesPluginConfigController } from './resourcesPluginConfigTypes';

interface ResourcesSourcesSectionProps {
    readonly controller: ResourcesPluginConfigController;
}

export function ResourcesSourcesSection({ controller }: ResourcesSourcesSectionProps) {
    const { t } = useTranslation();
    const {
        busy,
        cancelSynchronization,
        editRepository,
        focusCredentialForSource,
        hiddenSourceCount,
        openNewRepository,
        requestDelete,
        restoreHiddenSources,
        resumeSynchronization,
        synchronize,
        toggleHidden,
        toggleSource,
        visibleSources,
    } = controller;

    return (
        <section className="resources-plugin-config__section">
            <div className="resources-plugin-config__heading">
                <div>
                    <h4>{t('literature.settings.sources_title')}</h4>
                    <p>{t('literature.settings.sources_help')}</p>
                </div>
                <button
                    type="button"
                    className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action"
                    onClick={restoreHiddenSources}
                    disabled={busy === 'configuration' || hiddenSourceCount === 0}
                >
                    <RotateCcw size={14} />
                    {hiddenSourceCount > 0
                        ? t('literature.settings.restore_hidden_sources', { count: hiddenSourceCount })
                        : t('literature.settings.no_hidden_sources')}
                </button>
            </div>

            <div className="resources-plugin-config__sources">
                {visibleSources.map((source) => {
                    const isSyncing = synchronizationActive(source);
                    const completeListSize = sourceCompleteListSize(source);
                    const indexedCount = source.sync?.indexed_count ?? 0;
                    const progressPercent = completeListSize > 0
                        ? Math.min(100, Math.round((indexedCount / completeListSize) * 100))
                        : null;
                    const group = sourceGroup(source);
                    const state = source.sync?.state ?? 'never';
                    const lastSuccessfulDatestamp = sourceLastSuccessfulDatestamp(source);
                    return (
                        <article key={source.id} className="resources-plugin-config__source">
                            <div className="resources-plugin-config__source-main">
                                <div className="resources-plugin-config__source-title-row">
                                    <strong>{source.name}</strong>
                                    <span className={`resources-plugin-config__status ${source.available ? 'is-ready' : ''} ${isSyncing ? 'is-syncing' : ''}`}>
                                        {isSyncing && (
                                            <Loader2 size={11} className="resources-plugin-config__spin" />
                                        )}
                                        {statusLabel(source, t)}
                                    </span>
                                </div>
                                {source.sync && (
                                    <small>
                                        {t('literature.settings.index_records', {
                                            count: source.sync.index_size ?? 0,
                                        })}
                                    </small>
                                )}
                                {source.sync && state !== 'never' && (
                                    <small className={isSyncing ? 'is-syncing-text' : ''}>
                                        {t('literature.settings.sync_progress', {
                                            state: t(`literature.settings.sync_state_${state}`, state),
                                            received: source.sync.received_count ?? 0,
                                            indexed: indexedCount,
                                            deleted: source.sync.deleted_count ?? 0,
                                        })}
                                        {progressPercent !== null && ` (${progressPercent.toString()}%)`}
                                    </small>
                                )}
                                {isSyncing && progressPercent !== null && (
                                    <div
                                        className="resources-plugin-config__progress-track"
                                        role="progressbar"
                                        aria-valuenow={progressPercent}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                    >
                                        <div
                                            className="resources-plugin-config__progress-fill"
                                            style={{ width: `${progressPercent.toString()}%` }}
                                        />
                                    </div>
                                )}
                                {lastSuccessfulDatestamp && (
                                    <small>
                                        {t('literature.settings.last_sync', {
                                            date: new Date(lastSuccessfulDatestamp).toLocaleString(),
                                        })}
                                    </small>
                                )}
                                {source.sync?.error && (
                                    <small className="is-error">{source.sync.error}</small>
                                )}
                            </div>

                            <div className="resources-plugin-config__source-actions">
                                {sourceHasCredential(source) && (
                                    <button
                                        type="button"
                                        className="gnosi-icon-button resources-plugin-config__icon-button"
                                        title={t('literature.settings.configure_credentials')}
                                        aria-label={t('literature.settings.configure_credentials')}
                                        onClick={() => {
                                            focusCredentialForSource(source);
                                        }}
                                    >
                                        <KeyRound size={15} />
                                    </button>
                                )}
                                {source.kind === 'oai' && isSyncing && (
                                    <button
                                        type="button"
                                        className="gnosi-icon-button resources-plugin-config__icon-button is-danger"
                                        title={t('literature.settings.cancel_sync')}
                                        aria-label={t('literature.settings.cancel_sync')}
                                        disabled={busy === `sync:${source.id}`}
                                        onClick={() => {
                                            cancelSynchronization(source);
                                        }}
                                    >
                                        <Square size={15} />
                                    </button>
                                )}
                                {source.kind === 'oai' && (state === 'cancelled' || state === 'failed') && (
                                    <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button" title={t('literature.settings.resume_sync')} aria-label={t('literature.settings.resume_sync')} disabled={busy === `sync:${source.id}`} onClick={() => { resumeSynchronization(source); }}>
                                        <Play size={15} />
                                    </button>
                                )}
                                {source.kind === 'oai' && !isSyncing && (
                                    <>
                                        <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button" title={t('literature.settings.synchronize')} aria-label={t('literature.settings.synchronize')} disabled={busy === `sync:${source.id}`} onClick={() => { synchronize(source); }}>
                                            <RefreshCw size={15} />
                                        </button>
                                        <button type="button" className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action" title={t('literature.settings.full_reindex_help')} disabled={busy === `sync:${source.id}`} onClick={() => { synchronize(source, true); }}>
                                            {t('literature.settings.full_reindex')}
                                        </button>
                                    </>
                                )}
                                {group === 'custom' && (
                                    <>
                                        <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => { editRepository(source); }}><Pencil size={15} /></button>
                                        <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button is-danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => { requestDelete(source); }}><Trash2 size={15} /></button>
                                    </>
                                )}
                                {group !== 'custom' && source.kind !== 'external' && source.kind !== 'metric' && (
                                    <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button" title={source.hidden ? t('literature.settings.restore') : t('literature.settings.hide')} aria-label={source.hidden ? t('literature.settings.restore') : t('literature.settings.hide')} onClick={() => { toggleHidden(source, !source.hidden); }}>
                                        {source.hidden ? <RotateCcw size={15} /> : <EyeOff size={15} />}
                                    </button>
                                )}
                                {source.automated && (
                                    <button type="button" role="switch" aria-checked={source.enabled === true} aria-label={t(source.enabled ? 'literature.settings.disable_source' : 'literature.settings.enable_source', { name: source.name })} className={`gnosi-toggle resource-source-switch ${source.enabled ? 'active' : ''}`} onClick={() => { toggleSource(source, !source.enabled); }}>
                                        <span className="gnosi-toggle-handle" />
                                    </button>
                                )}
                                {!source.automated && source.search_url && (
                                    <a className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action" href={source.search_url.replace('{query}', '')} target="_blank" rel="noreferrer">
                                        <Search size={14} /> {t('literature.settings.open_external')}
                                    </a>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>

            <button
                type="button"
                className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action resources-plugin-config__add-button"
                onClick={openNewRepository}
            >
                <Plus size={14} /> {t('literature.settings.add_repository')}
            </button>
        </section>
    );
}
