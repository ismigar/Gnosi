import type { TFunction } from 'i18next';
import type { InternalContextSource } from '../../../shared/api/agent-context';
import { contextOptionLabel } from './agentContextLabels';
import { contextBoolean, contextNamedOptions, contextString, contextStringArray, type ContextReference } from './agentContextModel';

export function sourceSummary(t: TFunction, reference: ContextReference, descriptor?: InternalContextSource): string {
    if (reference.type === 'vault') return t('settings.ai.context_whole_vault', 'Entire active vault');
    if (reference.type === 'url') return reference.ref;
    const kindKey = { file: 'context_add_file', source: 'context_add_external', page: 'context_add_page', table: 'context_add_table', database: 'context_add_table' };
    if (reference.type !== 'internal') return t(`settings.ai.${kindKey[reference.type]}`);
    const scope = reference.scope ?? descriptor?.scope ?? {};
    const parts: string[] = [];
    const fields: Record<string, string> = {
        accounts: 'context_accounts', source_ids: 'context_reader_feeds', categories: 'context_categories',
        sources: 'context_contact_sources', types: 'context_contact_types', entity_types: 'context_planning_entities',
        project_ids: 'context_planning_projects', resource_ids: 'context_planning_resources', item_types: 'context_reference_types',
        languages: 'context_reference_languages', networks: 'context_social_networks', statuses: 'context_social_statuses',
        object_types: 'context_notion_types', database_ids: 'context_notion_databases',
    };
    for (const [field, key] of Object.entries(fields)) {
        const value = scope[field];
        if (!Array.isArray(value) || !value.length) continue;
        if (value.length > 1) { parts.push(`${String(value.length)} ${t(`settings.ai.${key}`).toLowerCase()}`); continue; }
        const catalogKey = { source_ids: 'sources', project_ids: 'projects', resource_ids: 'resources', database_ids: 'databases' }[field];
        const identifier = String(value[0]);
        const name = catalogKey ? contextNamedOptions(descriptor?.options, catalogKey).find(option => String(option.id) === identifier)?.name ?? identifier
            : ['entity_types', 'sources', 'types', 'object_types', 'networks', 'statuses'].includes(field) ? contextOptionLabel(t, identifier) : identifier;
        parts.push(`${t(`settings.ai.${key}`)}: ${name}`);
    }
    if (reference.ref === 'mail') {
        const selected = contextStringArray(scope, 'accounts');
        const accounts = selected.length ? selected : contextStringArray(descriptor?.options, 'accounts');
        const folders = scope.folders_by_account;
        let count = 0;
        for (const account of accounts) {
            const values = folders && typeof folders === 'object' ? Reflect.get(folders, account) as unknown : undefined;
            count += Array.isArray(values) && values.length ? values.length : 1;
        }
        parts.push(count ? t('settings.ai.sources.folder_count', '{{count}} folders', { count }) : contextString(scope, 'folder', 'INBOX'));
    }
    if (reference.ref === 'reader') {
        parts.push(t(contextBoolean(scope, 'unread_only', true) ? 'settings.ai.context_reader_unread' : 'settings.ai.sources.all_articles'));
        if (contextBoolean(scope, 'include_full_content', false)) parts.push(t('settings.ai.context_full_content'));
    }
    if (reference.ref === 'planning' && contextBoolean(scope, 'include_inactive', false)) parts.push(t('settings.ai.context_planning_inactive'));
    if (reference.ref === 'calendar' && contextBoolean(scope, 'include_vault', true)) parts.push(t('settings.ai.context_calendar_vault'));
    const from = contextString(scope, 'date_from').slice(0, 10);
    const to = contextString(scope, 'date_to').slice(0, 10);
    if (reference.ref === 'calendar') {
        parts.push(`${from || t('settings.ai.sources.days_ago', '30 days ago')} → ${to || t('settings.ai.sources.days_ahead', '90 days ahead')}`);
    } else if (from || to) {
        parts.push(`${from || '…'} → ${to || '…'}`);
    }
    return parts.join(' · ') || t('settings.ai.sources.all', 'All');
}
