import { CheckCircle2, CircleAlert, Database, KeyRound, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ConfirmModal from '../../../../shared/ui/dialogs/ConfirmModal';
import { ResourcesCredentialsSection } from './ResourcesCredentialsSection';
import { ResourcesRepositoryForm } from './ResourcesRepositoryForm';
import { ResourcesSourcesSection } from './ResourcesSourcesSection';
import type { ResourcesPluginConfigController } from './resourcesPluginConfigTypes';

interface ResourcesPluginConfigViewProps {
    readonly controller: ResourcesPluginConfigController;
}

export function ResourcesPluginConfigView({
    controller,
}: ResourcesPluginConfigViewProps) {
    const { t } = useTranslation();
    const {
        busy,
        closeDeleteConfirmation,
        commitContactEmail,
        confirmDelete,
        configuration,
        contactEmailInput,
        createReference,
        deleteIndex,
        deleteTarget,
        error,
        loading,
        markContactEmailEditing,
        notice,
        referenceTable,
        selectReferenceTable,
        setContactEmailInput,
        setDeleteIndex,
        showCredentialsInline,
        showRepositoryForm,
        tables,
        toggleCredentials,
    } = controller;

    if (loading && configuration.sources.length === 0) {
        return (
            <div className="resources-plugin-config" role="status">
                {t('common.loading')}
            </div>
        );
    }

    return (
        <div className="resources-plugin-config">
            {error && (
                <div className="resources-plugin-config__error" role="alert">
                    <CircleAlert size={15} /> {error}
                </div>
            )}
            {notice && (
                <div className="resources-plugin-config__notice" role="status">
                    <CheckCircle2 size={15} /> {notice}
                </div>
            )}

            <section className="resources-plugin-config__section">
                <div className="resources-plugin-config__heading">
                    <div>
                        <h4>{t('literature.settings.resources_table')}</h4>
                        <p>{t('literature.settings.resources_table_help')}</p>
                    </div>
                    <Database size={18} />
                </div>
                <div className="resources-plugin-config__row">
                    <select
                        value={referenceTable.table_id ?? ''}
                        disabled={busy === 'reference'}
                        onChange={(event) => {
                            selectReferenceTable(event.target.value);
                        }}
                        aria-label={t('literature.settings.resources_table')}
                    >
                        <option value="">{t('literature.settings.no_resources_table')}</option>
                        {tables.map((table) => (
                            <option key={table.id} value={table.id}>{table.name}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action"
                        onClick={createReference}
                        disabled={busy === 'reference'}
                    >
                        <Plus size={14} /> {t('literature.settings.create_resources_table')}
                    </button>
                </div>
            </section>

            <section className="resources-plugin-config__section">
                <div className="resources-plugin-config__heading">
                    <div>
                        <h4>{t('literature.settings.contact_title')}</h4>
                        <p>{t('literature.settings.contact_help')}</p>
                    </div>
                    <KeyRound size={18} />
                </div>
                <div className="resources-plugin-config__row">
                    <input
                        type="email"
                        value={contactEmailInput}
                        placeholder={t('literature.settings.contact_placeholder')}
                        onFocus={markContactEmailEditing}
                        onChange={(event) => {
                            setContactEmailInput(event.target.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                        onBlur={commitContactEmail}
                    />
                    <button
                        type="button"
                        className={`btn-gnosi btn-gnosi-secondary resources-plugin-config__action ${showCredentialsInline ? 'is-active' : ''}`}
                        onClick={toggleCredentials}
                    >
                        <KeyRound size={14} /> {t('literature.settings.manage_credentials')}
                    </button>
                </div>
                {showCredentialsInline && (
                    <ResourcesCredentialsSection controller={controller} />
                )}
            </section>

            <ResourcesSourcesSection controller={controller} />
            {showRepositoryForm && <ResourcesRepositoryForm controller={controller} />}

            <ConfirmModal
                isOpen={deleteTarget !== null}
                onClose={closeDeleteConfirmation}
                onConfirm={confirmDelete}
                title={t('literature.settings.delete_repository_title')}
                message={t('literature.settings.delete_repository_message', {
                    name: deleteTarget?.name ?? '',
                })}
                confirmText={t('common.delete')}
                isDestructive
            >
                <label className="resources-plugin-config__delete-index">
                    <input
                        type="checkbox"
                        checked={deleteIndex}
                        onChange={(event) => {
                            setDeleteIndex(event.target.checked);
                        }}
                    />{' '}
                    {t('literature.settings.delete_index_too')}
                </label>
            </ConfirmModal>
        </div>
    );
}
