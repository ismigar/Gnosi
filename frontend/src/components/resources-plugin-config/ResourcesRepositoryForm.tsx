import { Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { REST_MAPPING_FIELDS } from './resourcesPluginConfigModel';
import type { ResourcesPluginConfigController } from './resourcesPluginConfigTypes';

interface ResourcesRepositoryFormProps {
    readonly controller: ResourcesPluginConfigController;
}

export function ResourcesRepositoryForm({
    controller,
}: ResourcesRepositoryFormProps) {
    const { t } = useTranslation();
    const {
        busy,
        closeRepositoryForm,
        repository,
        repositoryStaticFilters,
        saveRepository,
        setRepositoryField,
        setRepositoryMapping,
        setRepositoryStaticFilters,
        testRepository,
    } = controller;

    return (
        <section className="resources-plugin-config__section resources-plugin-config__form">
            <div className="resources-plugin-config__heading">
                <div>
                    <h4>
                        {repository.id
                            ? t('literature.settings.edit_repository')
                            : t('literature.settings.add_repository')}
                    </h4>
                    <p>{t('literature.settings.repository_help')}</p>
                </div>
                <Wifi size={18} />
            </div>
            <div className="resources-plugin-config__grid">
                <label>
                    <span>{t('literature.settings.repository_name')}</span>
                    <input
                        value={repository.name}
                        onChange={(event) => {
                            setRepositoryField('name', event.target.value);
                        }}
                    />
                </label>
                <label>
                    <span>{t('literature.settings.repository_kind')}</span>
                    <select
                        value={repository.kind}
                        onChange={(event) => {
                            setRepositoryField(
                                'kind',
                                event.target.value === 'rest' ? 'rest' : 'oai',
                            );
                        }}
                    >
                        <option value="oai">OAI-PMH</option>
                        <option value="rest">REST JSON</option>
                    </select>
                </label>
                <label className="is-wide">
                    <span>{t('literature.settings.repository_url')}</span>
                    <input
                        type="url"
                        value={repository.base_url}
                        onChange={(event) => {
                            setRepositoryField('base_url', event.target.value);
                        }}
                        placeholder="https://repository.example.org/oai"
                    />
                </label>

                {repository.kind === 'oai' ? (
                    <>
                        <label>
                            <span>{t('literature.settings.metadata_prefix')}</span>
                            <input
                                value={repository.metadata_prefix}
                                onChange={(event) => {
                                    setRepositoryField('metadata_prefix', event.target.value);
                                }}
                            />
                        </label>
                        <label>
                            <span>{t('literature.settings.oai_set')}</span>
                            <input
                                value={repository.set}
                                onChange={(event) => {
                                    setRepositoryField('set', event.target.value);
                                }}
                            />
                        </label>
                    </>
                ) : (
                    <>
                        <label><span>{t('literature.settings.query_parameter')}</span><input value={repository.query_parameter} onChange={(event) => { setRepositoryField('query_parameter', event.target.value); }} /></label>
                        <label><span>{t('literature.settings.limit_parameter')}</span><input value={repository.limit_parameter} onChange={(event) => { setRepositoryField('limit_parameter', event.target.value); }} /></label>
                        <label><span>{t('literature.settings.results_path')}</span><input value={repository.results_path} onChange={(event) => { setRepositoryField('results_path', event.target.value); }} /></label>
                        <label>
                            <span>{t('literature.settings.pagination')}</span>
                            <select
                                value={repository.pagination}
                                onChange={(event) => {
                                    const value = event.target.value;
                                    const pagination = value === 'page'
                                        || value === 'offset'
                                        || value === 'cursor'
                                        || value === 'link'
                                        ? value
                                        : 'none';
                                    setRepositoryField('pagination', pagination);
                                }}
                            >
                                <option value="none">None</option>
                                <option value="page">Page</option>
                                <option value="offset">Offset</option>
                                <option value="cursor">Cursor</option>
                                <option value="link">HTTP Link</option>
                            </select>
                        </label>
                        {repository.pagination === 'page' && <label><span>{t('literature.settings.page_parameter')}</span><input value={repository.page_parameter} onChange={(event) => { setRepositoryField('page_parameter', event.target.value); }} /></label>}
                        {repository.pagination === 'offset' && <label><span>{t('literature.settings.offset_parameter')}</span><input value={repository.offset_parameter} onChange={(event) => { setRepositoryField('offset_parameter', event.target.value); }} /></label>}
                        {repository.pagination === 'cursor' && (
                            <>
                                <label><span>{t('literature.settings.cursor_parameter')}</span><input value={repository.cursor_parameter} onChange={(event) => { setRepositoryField('cursor_parameter', event.target.value); }} /></label>
                                <label><span>{t('literature.settings.next_cursor_path')}</span><input value={repository.next_cursor_path} onChange={(event) => { setRepositoryField('next_cursor_path', event.target.value); }} /></label>
                            </>
                        )}
                        <label className="is-wide">
                            <span>{t('literature.settings.static_filters')}</span>
                            <textarea
                                rows={3}
                                value={repositoryStaticFilters}
                                onChange={(event) => {
                                    setRepositoryStaticFilters(event.target.value);
                                }}
                                placeholder={'type=article\nstatus=published'}
                            />
                            <small>{t('literature.settings.static_filters_help')}</small>
                        </label>
                        {REST_MAPPING_FIELDS.map((field) => (
                            <label key={field}>
                                <span>{t('literature.settings.mapping_field', { field })}</span>
                                <input
                                    value={repository.mapping[field] ?? ''}
                                    onChange={(event) => {
                                        setRepositoryMapping(field, event.target.value);
                                    }}
                                />
                            </label>
                        ))}
                    </>
                )}
            </div>
            <div className="resources-plugin-config__row">
                <button type="button" className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action" disabled={busy === 'test'} onClick={testRepository}>
                    <Wifi size={14} /> {t('literature.settings.test_repository')}
                </button>
                <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={busy === 'repository' || !repository.name || !repository.base_url} onClick={saveRepository}>
                    {t('common.save')}
                </button>
                <button type="button" className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action" onClick={closeRepositoryForm}>
                    {t('common.cancel')}
                </button>
            </div>
        </section>
    );
}
