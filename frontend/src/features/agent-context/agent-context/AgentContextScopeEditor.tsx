import type { ChangeEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
    readonly onPatch: (patch: ContextScope) => void;
    readonly reference: ContextReference;
    readonly sourceLabel: string;
}


const selectedValues = (event: ChangeEvent<HTMLSelectElement>): string[] => (
    Array.from(event.target.selectedOptions, (option) => option.value)
);


const optionStrings = (values: readonly string[]): NamedContextOption[] => (
    values.map((value) => ({ id: value, name: value }))
);


function ScopeSelect({
    label,
    numeric = false,
    onChange,
    options,
    values,
}: {
    readonly label: string;
    readonly numeric?: boolean;
    readonly onChange: (values: number[] | string[]) => void;
    readonly options: readonly NamedContextOption[];
    readonly values: readonly (number | string)[];
}) {
    return (
        <label style={{ fontSize: '0.78rem' }}>
            {label}
            <select
                className="gnosi-input"
                multiple
                onChange={(event) => {
                    const selected = selectedValues(event);
                    onChange(numeric ? selected.map(Number) : selected);
                }}
                style={{ marginTop: '5px', minHeight: '76px', width: '100%' }}
                value={values.map(String)}
            >
                {options.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                ))}
            </select>
        </label>
    );
}


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
        <label style={{ fontSize: '0.82rem' }}>
            <input
                checked={checked}
                onChange={(event) => {
                    onChange(event.target.checked);
                }}
                type="checkbox"
            />{' '}
            {children}
        </label>
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
        <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
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
    onPatch,
    reference,
    sourceLabel,
}: ScopeEditorProps) {
    const { t } = useTranslation();
    const { options } = descriptor;
    const scope = reference.scope;
    const strings = (key: string): NamedContextOption[] => (
        optionStrings(contextOptionStrings(options, key))
    );
    const select = (
        key: string,
        label: string,
        namedOptions = strings(key),
        numeric = false,
    ): ReactNode => (
        <ScopeSelect
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
        <div style={{
            background: 'var(--settings-bg)',
            border: '1px solid var(--settings-border)',
            borderRadius: '14px',
            display: 'grid',
            gap: '12px',
            padding: '14px',
        }}>
            <div>
                <strong style={{ fontSize: '0.88rem' }}>
                    {t('settings.ai.context_scope_title', '{{source}} scope', {
                        source: sourceLabel,
                    })}
                </strong>
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
                            onPatch({ unread_only: checked });
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
            {reference.ref === 'mail' ? (
                <label style={{ fontSize: '0.78rem' }}>
                    {t('settings.ai.context_mail_folder', 'Folder')}
                    <input
                        className="gnosi-input"
                        onChange={(event) => {
                            onPatch({ folder: event.target.value });
                        }}
                        style={{ marginTop: '5px', width: '100%' }}
                        value={contextString(scope, 'folder', 'INBOX')}
                    />
                </label>
            ) : null}
            {reference.ref === 'calendar' ? (
                <>
                    <DateRange onPatch={onPatch} scope={scope} />
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
                <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
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
                    <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
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
                <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
                    {select('item_types', t('settings.ai.context_reference_types', 'Reference types'))}
                    {select('languages', t('settings.ai.context_reference_languages', 'Languages'))}
                </div>
            ) : null}
            {reference.ref === 'social' ? (
                <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
                    {select('networks', t('settings.ai.context_social_networks', 'Networks'))}
                    {select('statuses', t('settings.ai.context_social_statuses', 'Publication statuses'))}
                </div>
            ) : null}
            {reference.ref === 'meetings'
                ? <DateRange onPatch={onPatch} scope={scope} />
                : null}
            {reference.ref === 'notion' ? (
                <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
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
