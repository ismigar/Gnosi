import { isJsonRecord } from '../AI/aiResourcesApi';
import type { SettingsDraft, SettingsAgent, IntegrationAccount, SettingsIntegrations, MailAlias, SettingsRegistryEntry } from './types';

const optional = (value: unknown, predicate: (value: unknown) => boolean) => value === undefined || value === null || predicate(value);
const string = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number => typeof value === 'number';
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
const recordStrings = (value: unknown): value is Record<string, string> => isJsonRecord(value) && Object.values(value).every(string);
const aliases = (value: unknown): value is MailAlias[] => Array.isArray(value) && value.every((item: unknown) => isJsonRecord(item) && string(item.email) && ['display_name', 'signature'].every(key => optional(item[key], string)));

export function integrationAccount(value: unknown): value is IntegrationAccount {
  return isJsonRecord(value)
    && ['id', 'email', 'username', 'name', 'provider', 'server_url', 'password', 'display_name', 'subject_prefix', 'signature', 'certificate', 'imap_host', 'imap_user', 'imap_password', 'imap_encryption', 'smtp_host', 'smtp_user', 'smtp_password', 'smtp_encryption'].every(key => optional(value[key], string))
    && ['imap_port', 'smtp_port'].every(key => optional(value[key], item => string(item) || number(item)))
    && optional(value.enabled, boolean) && optional(value.aliases, aliases);
}

export function settingsIntegrations(value: Record<string, unknown>): SettingsIntegrations {
  for (const key of ['calendars', 'contacts', 'mail_accounts', 'emails']) {
    const rows = value[key];
    if (!optional(rows, item => Array.isArray(item) && item.every(integrationAccount))) throw new TypeError(`Invalid integrations ${key}`);
  }
  for (const key of ['default_calendar', 'default_contacts', 'default_mail']) if (!optional(value[key], string)) throw new TypeError(`Invalid integrations ${key}`);
  if (!optional(value.calendar_colors, recordStrings)) throw new TypeError('Invalid calendar colors');
  if (!optional(value.vault_calendar, item => isJsonRecord(item) && optional(item.enabled_tables, strings))) throw new TypeError('Invalid calendar table selection');
  // Validation narrows the known fields; spread/update must retain provider extensions.
  return value;
}

export function settingsAgents(value: unknown): SettingsAgent[] {
  if (value == null) return [];
  if (!Array.isArray(value) || !value.every((item: unknown) => isJsonRecord(item) && string(item.id)
    && ['name', 'provider', 'model', 'icon', 'persona', 'context'].every(key => optional(item[key], string))
    && optional(item.enabled, boolean) && optional(item.skill_ids, strings)
    && optional(item.context_refs, refs => Array.isArray(refs) && refs.every((ref: unknown) => isJsonRecord(ref)
      && string(ref.id) && string(ref.label) && string(ref.ref)
      && string(ref.type) && ['database', 'file', 'internal', 'page', 'source', 'table', 'url', 'vault'].includes(ref.type)
      && optional(ref.scope, isJsonRecord))))) throw new TypeError('Invalid AI agent configuration');
  return value as SettingsAgent[];
}

function section(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (!isJsonRecord(value)) throw new TypeError('Invalid settings section');
  return value;
}

export function hydrateDraft(previous: SettingsDraft, config: Record<string, unknown>): SettingsDraft {
  const settings = section(config.settings);
  for (const key of ['user_name', 'workspace_name', 'gnosi_mode', 'org_user', 'org_password', 'org_workspace', 'language', 'currency', 'decimal_symbol', 'date_format', 'theme', 'active_workspace_id', 'workspace_id', 'user_id']) if (!optional(settings[key], string)) throw new TypeError(`Invalid setting ${key}`);
  if (!optional(settings.week_start, number) || !optional(settings.reduce_animations, boolean)) throw new TypeError('Invalid settings preference');
  if (!optional(settings.reader, reader => isJsonRecord(reader) && optional(reader.podcast, podcast => isJsonRecord(podcast) && string(podcast.provider) && string(podcast.model)))) throw new TypeError('Invalid podcast model route');
  const paths = section(config.paths);
  if (!recordStrings(paths)) throw new TypeError('Invalid configured paths');
  const graph = section(config.graph);
  for (const key of ['visible_databases', 'visible_tables', 'visible_fields']) if (!optional(graph[key], strings)) throw new TypeError(`Invalid graph ${key}`);
  for (const key of ['label_threshold', 'node_size', 'edge_thickness']) if (!optional(graph[key], number)) throw new TypeError(`Invalid graph ${key}`);
  if (!optional(graph.show_arrows, boolean) || !optional(graph.field_defaults, recordStrings)) throw new TypeError('Invalid graph options');
  if (!optional(graph.physics, physics => isJsonRecord(physics) && ['gravity', 'repulsion', 'friction'].every(key => number(physics[key])))) throw new TypeError('Invalid graph physics');
  const ai = section(config.ai);
  if (!optional(ai.active_agent_id, string)) throw new TypeError('Invalid active agent');
  return {
    ...previous,
    settings: { ...previous.settings, ...settings },
    paths: { ...previous.paths, ...paths },
    graph: { ...previous.graph, ...graph },
    ai: { ...previous.ai, agents: settingsAgents(ai.agents), active_agent_id: typeof ai.active_agent_id === 'string' ? ai.active_agent_id : '' },
  };
}

export function errorDetail(error: unknown, fallback: string): string {
  if (isJsonRecord(error) && isJsonRecord(error.response) && isJsonRecord(error.response.data) && typeof error.response.data.detail === 'string') return error.response.data.detail;
  return error instanceof Error ? error.message : fallback;
}

export function settingsRegistry(rows: Record<string, unknown>[]): SettingsRegistryEntry[] {
  if (!rows.every(row => string(row.id) && string(row.name)
    && ['color', 'database_id', 'folder'].every(key => optional(row[key], string))
    && optional(row.properties, fields => Array.isArray(fields) && fields.every((field: unknown) => isJsonRecord(field) && string(field.name) && optional(field.type, string))))) throw new TypeError('Invalid settings registry');
  return rows as SettingsRegistryEntry[];
}
