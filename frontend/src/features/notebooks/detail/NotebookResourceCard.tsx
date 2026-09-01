import { useTranslation } from 'react-i18next';
import type { NotebookController } from './useNotebookController';
import { BookOpen, Globe2, RefreshCw, X } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { isIndexing } from './notebookModel';
import type { NotebookResource } from './notebookTypes';

export default function NotebookResourceCard({ resource, currentGroupId, controller }: { resource: NotebookResource; currentGroupId: string | null; controller: NotebookController }) {
    const { t } = useTranslation();
    const { notebook, selectedSourceIds, toggleResourceSources, toggleSingleSource, handleMoveResource, retryResource, retryingId, removingId, remove } = controller;
    const customGroups = notebook.groups || [];
        const resourceSourceIds = resource.sources.map((s) => s.source_id);
        const isSelected = resourceSourceIds.length > 0
            && resourceSourceIds.every((id) => selectedSourceIds.has(id));

        return (
            <article
                key={resource.resource_id}
                className={`notebook-source-card ${isSelected ? 'is-selected' : ''}`}
            >
                <div className="notebook-source-card__header">
                    <div className="notebook-source-card__title-row">
                        <input
                            type="checkbox"
                            className="notebook-source-checkbox"
                            checked={isSelected}
                            onChange={() => { toggleResourceSources(resource); }}
                            aria-label={resource.title || resource.resource_id}
                        />
                        <span className="notebook-source-card__icon" aria-hidden="true">
                            {resource.sources[0]?.kind === 'url' ? <Globe2 size={13} /> : <BookOpen size={13} />}
                        </span>
                        <strong className="notebook-source-card__title" title={resource.title || resource.resource_id}>
                            {resource.title || resource.resource_id}
                        </strong>
                        {resource.state && resource.state !== 'available' && (
                            <StatusBadge status={resource.state} />
                        )}
                    </div>
                    {notebook.can_manage && (
                        <div className="notebook-source-card__actions">
                            {customGroups.length > 0 && (
                                <select
                                    className="notebook-group-select"
                                    value={currentGroupId || ''}
                                    onChange={(event) => { void handleMoveResource(resource.resource_id, event.target.value); }}
                                    title={t('notebooks.move_to_group', 'Move to group...')}
                                    aria-label={t('notebooks.move_to_group', 'Move to group...')}
                                >
                                    <option value="">{t('notebooks.ungrouped', 'Ungrouped')}</option>
                                    {customGroups.map((g) => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                </select>
                            )}
                            {['error', 'stale'].includes(resource.state) && (
                                <button
                                    type="button"
                                    className="notebook-icon-button notebook-icon-button--small"
                                    disabled={retryingId === resource.resource_id || isIndexing(notebook)}
                                    onClick={() => { void retryResource(resource.resource_id); }}
                                    aria-label={t('notebooks.retry_resource', 'Retry Resource')}
                                >
                                    <RefreshCw size={13} className={retryingId === resource.resource_id ? 'animate-spin' : ''} />
                                </button>
                            )}
                            <button
                                type="button"
                                className="notebook-icon-button notebook-icon-button--small"
                                disabled={removingId === resource.resource_id}
                                onClick={() => { void remove(resource.resource_id); }}
                                aria-label={t('notebooks.remove_resource', 'Remove Resource')}
                            >
                                <X size={14} />
                            </button>
                        </div>
                    )}
                </div>

                {resource.error && <p className="notebook-source-error">{resource.error}</p>}
                {resource.last_checked_at && (
                    <p className="notebook-source-checked">
                        {t('notebooks.last_checked', 'Last checked: {{time}}', { time: new Date(resource.last_checked_at).toLocaleString() })}
                    </p>
                )}

                {resource.sources.length > 1 && (
                    <ul className="notebook-group-sources-list">
                        {resource.sources.map((source) => {
                            const sId = source.source_id;
                            const isChecked = selectedSourceIds.has(sId);
                            return (
                                <li key={source.source_id} className={`notebook-group-source-item ${isChecked ? 'is-selected' : ''}`}>
                                    <div className="notebook-group-source-item__main">
                                        <input
                                            type="checkbox"
                                            className="notebook-source-checkbox"
                                            checked={isChecked}
                                            onChange={() => { toggleSingleSource(source.source_id); }}
                                            aria-label={source.label}
                                        />
                                        <span className="notebook-group-source-icon">
                                            {source.kind === 'url' ? <Globe2 size={13} /> : <BookOpen size={13} />}
                                        </span>
                                        <span className="notebook-group-source-label" title={source.label}>
                                            {source.label}
                                        </span>
                                    </div>
                                    <div className="notebook-group-source-item__status">
                                        {source.error && <small className="notebook-source-error-inline">{source.error}</small>}
                                        {source.status && source.status !== 'available' && <StatusBadge status={source.status} />}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </article>
        );
}
