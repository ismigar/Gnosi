import { useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    LockKeyhole,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    resourceRoleLabel,
    resourceStatusLabel,
    toolDisplayDescription,
    toolDisplayName,
} from './aiResourceI18n';
import { originLabel } from './aiResourceLabels';
import type { ToolResources } from './aiResourceSettingsTypes';
import {
    CatalogError,
    EffectBadges,
    EmptyState,
    JsonSchemaDetails,
    ResourceState,
    SearchField,
} from './AIResourcePrimitives';


export function ToolsSettingsPanel({
    resources,
}: {
    readonly resources: ToolResources;
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('all');
    const [expandedId, setExpandedId] = useState('');
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = resources.tools.filter((tool) => (
        (status === 'all' || tool.status === status)
        && (
            !normalizedSearch
            || `${toolDisplayName(t, tool)} ${toolDisplayDescription(t, tool)} ${tool.id}`
                .toLowerCase()
                .includes(normalizedSearch)
        )
    ));

    return (
        <div className="ai-resources-panel">
            <div className="ai-resource-alert">
                <LockKeyhole size={18} />
                <span>{t('settings.ai.resources.tools_governance')}</span>
            </div>
            <div className="ai-resources-toolbar">
                <SearchField
                    onChange={setSearch}
                    placeholder={t('settings.ai.resources.search_tools')}
                    value={search}
                />
                <select
                    className="gnosi-select"
                    onChange={(event) => {
                        setStatus(event.target.value);
                    }}
                    value={status}
                >
                    {[
                        'all',
                        'available',
                        'pending',
                        'suspended',
                        'rejected',
                        'revoked',
                        'unavailable',
                    ].map((value) => (
                        <option key={value} value={value}>
                            {t(value === 'all'
                                ? 'settings.ai.resources.all_statuses'
                                : `settings.ai.resources.status_${value}`)}
                        </option>
                    ))}
                </select>
            </div>
            <CatalogError error={resources.error} onRetry={resources.reload} />
            <div className="ai-resource-list">
                {filtered.map((tool) => {
                    const expanded = expandedId === tool.id;
                    return (
                        <article
                            className={`ai-resource-card ${expanded
                                ? 'is-expanded'
                                : ''}`}
                            key={tool.id}
                        >
                            <button
                                className="ai-resource-card__main"
                                onClick={() => {
                                    setExpandedId((current) => (
                                        current === tool.id ? '' : tool.id
                                    ));
                                }}
                                type="button"
                            >
                                {expanded
                                    ? <ChevronDown size={18} />
                                    : <ChevronRight size={18} />}
                                <span className="ai-resource-card__copy">
                                    <span className="ai-resource-card__heading">
                                        <strong>{toolDisplayName(t, tool)}</strong>
                                        <code>{tool.id}</code>
                                    </span>
                                    <span>{toolDisplayDescription(t, tool)
                                        || t('settings.ai.resources.no_description')}</span>
                                    <span className="ai-resource-card__meta">
                                        <span>{originLabel(t, tool.origin)}</span>
                                        <span>{t('settings.ai.resources.version', {
                                            version: tool.version,
                                        })}</span>
                                        {tool.minimumRole ? (
                                            <span>{t('settings.ai.resources.minimum_role', {
                                                role: resourceRoleLabel(t, tool.minimumRole),
                                            })}</span>
                                        ) : null}
                                    </span>
                                    <EffectBadges effects={tool.effects} />
                                </span>
                                <ResourceState
                                    available={tool.available}
                                    status={tool.status}
                                />
                            </button>
                            {expanded ? (
                                <div className="ai-resource-details">
                                    <div>
                                        <strong>{t('settings.ai.resources.confirmation')}</strong>
                                        <span>{resourceStatusLabel(t, tool.confirmation)}</span>
                                    </div>
                                    <div>
                                        <strong>{t('settings.ai.resources.consuming_skills')}</strong>
                                        <span>{tool.skillIds.length > 0
                                            ? tool.skillIds.join(', ')
                                            : t('settings.ai.resources.no_skills_using_tool')}</span>
                                    </div>
                                    {tool.approvalStatus ? (
                                        <div>
                                            <strong>{t('settings.ai.resources.approval')}</strong>
                                            <span>{resourceStatusLabel(
                                                t,
                                                tool.approvalStatus,
                                            )}</span>
                                        </div>
                                    ) : null}
                                    <JsonSchemaDetails
                                        label={t('settings.ai.resources.input_schema')}
                                        schema={tool.inputSchema}
                                    />
                                    <JsonSchemaDetails
                                        label={t('settings.ai.resources.output_schema')}
                                        schema={tool.outputSchema}
                                    />
                                </div>
                            ) : null}
                        </article>
                    );
                })}
                {!resources.loading && filtered.length === 0 ? (
                    <EmptyState>{t('settings.ai.resources.no_tools_catalog')}</EmptyState>
                ) : null}
            </div>
        </div>
    );
}
