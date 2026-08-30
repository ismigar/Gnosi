import {
    type RefObject,
    type SyntheticEvent,
} from 'react';
import {
    BookOpen,
    Check,
    ChevronLeft,
    ChevronRight,
    Search,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReferenceResource } from '../../../shared/api/notebooks';
import NotebookResourceFilters, {
    type NotebookResourceFiltersProps,
} from './NotebookResourceFilters';

export type NotebookConversationMode = 'private_member' | 'shared';
export type NotebookResourceFilterKey = 'author' | 'tag' | 'type';
export type NotebookResourceFilters = Readonly<
    Record<NotebookResourceFilterKey, string>
>;
export type NotebookVisibility = 'private' | 'workspace';

export interface NotebookCreateDialogViewProps {
    readonly conversationMode: NotebookConversationMode;
    readonly creating: boolean;
    readonly dialogRef: RefObject<HTMLFormElement | null>;
    readonly facets: NotebookResourceFiltersProps['facets'];
    readonly filters: NotebookResourceFilters;
    readonly hiddenWithoutSources: number;
    readonly loadingResources: boolean;
    readonly onClose?: () => void;
    readonly onConversationModeChange: (value: NotebookConversationMode) => void;
    readonly onFilterChange: (
        key: NotebookResourceFilterKey | '',
        value: string,
    ) => void;
    readonly onPageChange: (delta: number) => void;
    readonly onQueryChange: (value: string) => void;
    readonly onSubmit: (
        event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
    ) => void;
    readonly onTitleChange: (value: string) => void;
    readonly onToggleResource: (resourceId: string) => void;
    readonly onVisibilityChange: (value: NotebookVisibility) => void;
    readonly page: number;
    readonly pageCount: number;
    readonly query: string;
    readonly resources: readonly ReferenceResource[];
    readonly selectedIds: ReadonlySet<string>;
    readonly title: string;
    readonly visibility: NotebookVisibility;
}

export default function NotebookCreateDialogView({
    conversationMode,
    creating,
    dialogRef,
    facets,
    filters,
    hiddenWithoutSources,
    loadingResources,
    onClose,
    onConversationModeChange,
    onFilterChange,
    onPageChange,
    onQueryChange,
    onSubmit,
    onTitleChange,
    onToggleResource,
    onVisibilityChange,
    page,
    pageCount,
    query,
    resources,
    selectedIds,
    title,
    visibility,
}: NotebookCreateDialogViewProps) {
    const { t } = useTranslation();
    return (
        <div className="notebook-modal-backdrop" role="presentation">
            <form
                ref={dialogRef}
                className="notebook-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="notebook-create-title"
                onSubmit={onSubmit}
            >
                <header className="notebook-modal__header">
                    <div className="notebook-modal__title-wrap">
                        <span className="notebook-icon"><BookOpen size={18} /></span>
                        <div>
                            <h2 id="notebook-create-title">
                                {t('notebooks.create_title', 'Create a notebook')}
                            </h2>
                            <p>{t(
                                'notebooks.create_subtitle',
                                'Only attachment and URL fields become sources.',
                            )}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="notebook-icon-button"
                        onClick={onClose}
                        disabled={creating}
                        aria-label={t('common.close', 'Close')}
                    >
                        <X size={18} />
                    </button>
                </header>

                <div className="notebook-modal__body">
                    <label className="notebook-field">
                        <span>{t('notebooks.title_label', 'Title')}</span>
                        <input
                            value={title}
                            onChange={(event) => {
                                onTitleChange(event.target.value);
                            }}
                            maxLength={160}
                            data-autofocus
                        />
                    </label>

                    <div className="notebook-modal__options">
                        <label className="notebook-field">
                            <span>{t('notebooks.visibility_label', 'Visibility')}</span>
                            <select
                                value={visibility}
                                onChange={(event) => {
                                    onVisibilityChange(
                                        event.target.value as NotebookVisibility,
                                    );
                                }}
                            >
                                <option value="private">
                                    {t('notebooks.visibility_private', 'Private')}
                                </option>
                                <option value="workspace">
                                    {t('notebooks.visibility_workspace', 'Workspace')}
                                </option>
                            </select>
                        </label>
                        <label className="notebook-field">
                            <span>{t('notebooks.conversation_label', 'Conversation')}</span>
                            <select
                                value={conversationMode}
                                onChange={(event) => {
                                    onConversationModeChange(
                                        event.target.value as NotebookConversationMode,
                                    );
                                }}
                            >
                                <option value="private_member">
                                    {t(
                                        'notebooks.conversation_private',
                                        'Private per member',
                                    )}
                                </option>
                                <option value="shared">
                                    {t('notebooks.conversation_shared', 'Shared')}
                                </option>
                            </select>
                        </label>
                    </div>

                    <section
                        className="notebook-resource-picker"
                        aria-label={t('notebooks.resources', 'Resources')}
                    >
                        <div className="notebook-resource-picker__header">
                            <strong>{t(
                                'notebooks.selected_resources',
                                '{{count}} Resources selected',
                                { count: selectedIds.size },
                            )}</strong>
                            <label className="notebook-search">
                                <Search size={15} />
                                <input
                                    value={query}
                                    onChange={(event) => {
                                        onQueryChange(event.target.value);
                                    }}
                                    placeholder={t(
                                        'notebooks.search_resources',
                                        'Search Resources...',
                                    )}
                                />
                            </label>
                        </div>
                        <NotebookResourceFilters
                            facets={facets}
                            filters={filters}
                            onChange={onFilterChange}
                            disabled={loadingResources}
                        />
                        {hiddenWithoutSources > 0 && (
                            <p className="notebook-resource-picker__notice" role="status">
                                {t(
                                    'notebooks.resources_without_sources_hidden',
                                    '{{count}} Resources are not shown because they have no attachments or URLs.',
                                    { count: hiddenWithoutSources },
                                )}
                            </p>
                        )}
                        <div className="notebook-resource-picker__list">
                            {loadingResources && (
                                <div className="notebook-empty">
                                    {t('common.loading', 'Loading...')}
                                </div>
                            )}
                            {!loadingResources && resources.map((resource) => {
                                const checked = selectedIds.has(resource.id);
                                return (
                                    <button
                                        key={resource.id}
                                        type="button"
                                        aria-pressed={checked}
                                        className={`notebook-resource-row ${checked ? 'is-selected' : ''}`}
                                        onClick={() => {
                                            onToggleResource(resource.id);
                                        }}
                                    >
                                        <span className="notebook-resource-row__check">
                                            {checked && <Check size={13} />}
                                        </span>
                                        <span className="notebook-resource-row__text">
                                            <strong>{resource.title}</strong>
                                            <small>{t(
                                                'notebooks.source_count',
                                                '{{count}} source(s)',
                                                { count: resource.source_count },
                                            )}</small>
                                        </span>
                                    </button>
                                );
                            })}
                            {!loadingResources && resources.length === 0 && (
                                <div className="notebook-empty">
                                    {t('notebooks.no_resources', 'No Resources found.')}
                                </div>
                            )}
                        </div>
                        {pageCount > 1 && (
                            <nav
                                className="notebook-pagination notebook-pagination--compact"
                                aria-label={t(
                                    'notebooks.resource_pagination',
                                    'Resource pages',
                                )}
                            >
                                <button
                                    type="button"
                                    aria-label={t('common.previous', 'Previous')}
                                    disabled={page <= 1}
                                    onClick={() => {
                                        onPageChange(-1);
                                    }}
                                >
                                    <ChevronLeft size={15} />
                                </button>
                                <span>{t(
                                    'notebooks.page_of',
                                    'Page {{page}} of {{pages}}',
                                    { page, pages: pageCount },
                                )}</span>
                                <button
                                    type="button"
                                    aria-label={t('common.next', 'Next')}
                                    disabled={page >= pageCount}
                                    onClick={() => {
                                        onPageChange(1);
                                    }}
                                >
                                    <ChevronRight size={15} />
                                </button>
                            </nav>
                        )}
                    </section>
                </div>

                <footer className="notebook-modal__footer">
                    <button
                        type="button"
                        className="btn-gnosi"
                        onClick={onClose}
                        disabled={creating}
                    >
                        {t('common.cancel', 'Cancel')}
                    </button>
                    <button
                        type="submit"
                        className="btn-gnosi btn-gnosi-primary"
                        disabled={selectedIds.size === 0 || creating}
                    >
                        {creating
                            ? t('notebooks.creating', 'Creating...')
                            : t('notebooks.create_action', 'Create notebook')}
                    </button>
                </footer>
            </form>
        </div>
    );
}
