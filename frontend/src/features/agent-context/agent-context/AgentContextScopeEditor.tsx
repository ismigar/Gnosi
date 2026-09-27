import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { ScopeMultiSelect } from './ScopeMultiSelect';
import { contextOptionLabel } from './agentContextLabels';
import { MailFolderScopes } from './MailFolderScopes';
import type { InternalContextSource } from '../../../shared/api/agent-context';
import {
    contextBoolean,
    contextNamedOptions,
    contextNumberArray,
    contextOptionStrings,
    contextString,
    contextStringArray,
    type ContextReference,
    type ContextScope,
    type NamedContextOption,
} from './agentContextModel';


interface ScopeEditorProps {
    readonly descriptor: InternalContextSource;
    readonly onRefresh: () => void;
    readonly onPatch: (patch: ContextScope) => void;
    readonly reference: ContextReference;
    readonly sourceLabel: string;
}


const optionStrings = (values: readonly string[]): NamedContextOption[] => values.map(value => ({ id: value, name: value }));

function ScopeCheckbox({
    checked,
    children,
    onChange,
}: {
    readonly checked: boolean;
    readonly children: ReactNode;
    readonly onChange: (checked: boolean) => void;
}) {
    return (
        <div className="agent-source-toggle">
            <GnosiToggle active={checked} label={typeof children === 'string' ? children : undefined} onChange={() => { onChange(!checked); }} />
            <span>{children}</span>
        </div>
    );
}


function DateRange({
    onPatch,
    scope,
}: {
    readonly onPatch: (patch: ContextScope) => void;
    readonly scope: ContextScope | undefined;
}) {
    const { t } = useTranslation();
    return (
        <div className="agent-source-grid">
            {(['date_from', 'date_to'] as const).map((key) => (
                <label key={key} style={{ fontSize: '0.78rem' }}>
                    {t(key === 'date_from'
                        ? 'settings.ai.context_date_from'
                        : 'settings.ai.context_date_to', key === 'date_from' ? 'From' : 'To')}
                    <input
                        className="gnosi-input"
                        onChange={(event) => {
                            onPatch({ [key]: event.target.value });
                        }}
                        style={{ marginTop: '5px', width: '100%' }}
                        type="date"
                        value={contextString(scope, key).slice(0, 10)}
                    />
                </label>
            ))}
        </div>
    );
}


export function AgentContextScopeEditor({
    descriptor,
    onRefresh,
    onPatch,
    reference,
    sourceLabel,
}: ScopeEditorProps) {
    const { t } = useTranslation();
    const { options } = descriptor;
    const scope = reference.scope;
    const strings = (key: string): NamedContextOption[] => (
        optionStrings(contextOptionStrings(options, key)).map(option => ({ ...option, name: ['entity_types', 'sources', 'types', 'object_types', 'networks', 'statuses'].includes(key) ? contextOptionLabel(t, option.name) : option.name }))
    );
    const select = (
        key: string,
        label: string,
        namedOptions = strings(key),
        numeric = false,
    ): ReactNode => (
        <ScopeMultiSelect
            label={label}
            numeric={numeric}
            onChange={(values) => {
                onPatch({ [key]: values });
            }}
            options={namedOptions}
            values={numeric
                ? contextNumberArray(scope, key)
                : contextStringArray(scope, key)}
        />
    );

    return (
        <div className="agent-source-scope">
            <div>
                <div className="agent-source-heading"><strong style={{ fontSize: '0.88rem' }}>
                    {t('settings.ai.context_scope_title', '{{source}} scope', {
                        source: sourceLabel,
                    })}
                </strong><RefreshButton onClick={onRefresh} /></div>
                <p style={{
                    color: 'var(--text-tertiary)',
                    fontSize: '0.78rem',
                    margin: '4px 0 0',
                }}>
                    {t(
                        'settings.ai.context_scope_desc',
                        'The agent can only search and read records inside this scope. Actions are governed separately.',
                    )}
                </p>
            </div>

            {reference.ref === 'reader' ? (
                <>
                    <ScopeCheckbox
                        checked={contextBoolean(scope, 'unread_only', true)}
                        onChange={(checked) => {
                            onPatch({ unread_only: checked, ...(typeof scope?.read_status === 'string' ? { read_status: checked ? 'unread' : 'all' } : {}) });
                        }}
                    >
                        {t('settings.ai.context_reader_unread', 'Unread articles only')}
                    </ScopeCheckbox>
                    {select(
                        'source_ids',
                        t('settings.ai.context_reader_feeds', 'Feeds'),
                        contextNamedOptions(options, 'sources'),
                        true,
                    )}
                    {select(
                        'categories',
                        t('settings.ai.context_categories', 'Categories'),
                    )}
                    <DateRange onPatch={onPatch} scope={scope} />
                    <ScopeCheckbox
                        checked={contextBoolean(scope, 'include_full_content', false)}
                        onChange={(checked) => {
                            onPatch({ include_full_content: checked });
                        }}
                    >
                        {t(
                            'settings.ai.context_full_content',
                            'Include full article bodies in exact reads',
                        )}
                    </ScopeCheckbox>
                </>
            ) : null}

            {reference.ref === 'mail' || reference.ref === 'calendar'
                ? select('accounts', t('settings.ai.context_accounts', 'Accounts'))
                : null}
            {reference.ref === 'mail' ? <MailFolderScopes scope={scope} options={options} onPatch={onPatch} /> : null}
            {reference.ref === 'calendar' ? (
                <>
                    <DateRange onPatch={onPatch} scope={scope} />
                    {!contextString(scope, 'date_from') || !contextString(scope, 'date_to') ? <small>{t('settings.ai.sources.calendar_default', 'Default dates: 30 days ago to 90 days ahead.')}</small> : null}
                    <ScopeCheckbox
                        checked={contextBoolean(scope, 'include_vault', true)}
                        onChange={(checked) => {
                            onPatch({ include_vault: checked });
                        }}
                    >
                        {t(
                            'settings.ai.context_calendar_vault',
                            'Include Vault calendar events',
                        )}
                    </ScopeCheckbox>
                </>
            ) : null}

            {reference.ref === 'contacts' ? (
                <div className="agent-source-grid">
                    {select('sources', t('settings.ai.context_contact_sources', 'Contact sources'))}
                    {select('types', t('settings.ai.context_contact_types', 'Contact types'))}
                </div>
            ) : null}
            {reference.ref === 'planning' ? (
                <>
                    {select(
                        'entity_types',
                        t('settings.ai.context_planning_entities', 'Planning entities'),
                    )}
                    <div className="agent-source-grid">
                        {select(
                            'project_ids',
                            t('settings.ai.context_planning_projects', 'Projects'),
                            contextNamedOptions(options, 'projects'),
                        )}
                        {select(
                            'resource_ids',
                            t('settings.ai.context_planning_resources', 'Resources'),
                            contextNamedOptions(options, 'resources'),
                        )}
                    </div>
                    <ScopeCheckbox
                        checked={contextBoolean(scope, 'include_inactive', false)}
                        onChange={(checked) => {
                            onPatch({ include_inactive: checked });
                        }}
                    >
                        {t(
                            'settings.ai.context_planning_inactive',
                            'Include inactive resources',
                        )}
                    </ScopeCheckbox>
                </>
            ) : null}
            {reference.ref === 'references' ? (
                <div className="agent-source-grid">
                    {select('item_types', t('settings.ai.context_reference_types', 'Reference types'))}
                    {select('languages', t('settings.ai.context_reference_languages', 'Languages'))}
                </div>
            ) : null}
            {reference.ref === 'social' ? (
                <div className="agent-source-grid">
                    {select('networks', t('settings.ai.context_social_networks', 'Networks'))}
                    {select('statuses', t('settings.ai.context_social_statuses', 'Publication statuses'))}
                </div>
            ) : null}
            {reference.ref === 'meetings'
                ? <DateRange onPatch={onPatch} scope={scope} />
                : null}
            {reference.ref === 'notion' ? (
                <div className="agent-source-grid">
                    {select('object_types', t('settings.ai.context_notion_types', 'Object types'))}
                    {select(
                        'database_ids',
                        t('settings.ai.context_notion_databases', 'Databases'),
                        contextNamedOptions(options, 'databases'),
                    )}
                </div>
            ) : null}
        </div>
    );
}
