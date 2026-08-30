import type { CSSProperties, ReactNode, KeyboardEvent, MouseEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { TOptions } from 'i18next';
import type { AppSidebarSettingsProps } from '../AppSidebarSettings';
import type { IdentityProfileData } from '../Vault/IdentityProfile';
import type { ContextReference } from '../agent-context/agentContextModel';
import type { AiModelRegistryEntry } from '../../shared/api/ai';
import type { fetchCalendarList } from '../../shared/api/calendar';
import type { fetchVaultGraph } from '../../shared/api/graph';

export interface GlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: string;
  initialPluginId?: string | null;
  sidebarNavigation?: AppSidebarSettingsProps | null;
}

export type SettingsTranslate = (key: string, options?: Omit<TOptions, 'context'> & { context?: string }) => string;
export type ToggleEvent = KeyboardEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>;
export interface ToggleProps {
  active?: boolean | null;
  onChange?: (event: ToggleEvent) => void;
  label?: string;
  style?: CSSProperties;
  scale?: number;
  display?: boolean;
}
export interface SectionProps {
  title: ReactNode;
  icon?: LucideIcon;
  children?: ReactNode;
  extra?: ReactNode;
}
export interface FormGroupProps {
  label?: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  horizontal?: boolean;
}

export interface SettingsAgent extends Record<string, unknown> {
  id: string;
  name?: string;
  provider?: string;
  model?: string;
  icon?: string;
  persona?: string;
  context?: string;
  enabled?: boolean;
  skill_ids?: string[];
  context_refs?: ContextReference[];
}
export type AgentDraft = Partial<SettingsAgent>;
export interface SettingsPreferences extends Record<string, unknown> {
  user_name: string;
  workspace_name: string;
  gnosi_mode: string;
  org_user: string;
  org_password: string;
  org_workspace: string;
  language: string;
  week_start: number;
  currency: string;
  decimal_symbol: string;
  date_format: string;
  theme: string;
  reduce_animations: boolean;
  active_workspace_id?: string;
  workspace_id?: string;
  user_id?: string;
  reader?: Record<string, unknown> & { podcast?: { provider: string; model: string } };
}
export interface GraphPreferences extends Record<string, unknown> {
  visible_databases?: string[];
  visible_tables?: string[];
  visible_fields?: string[];
  show_arrows: boolean;
  label_threshold: number;
  node_size: number;
  edge_thickness: number;
  physics: { gravity: number; repulsion: number; friction: number };
  field_defaults?: Record<string, string>;
}
export interface SettingsDraft {
  settings: SettingsPreferences;
  paths: Record<string, string>;
  graph: GraphPreferences;
  ai: { agents: SettingsAgent[]; providers: Record<string, unknown>; active_agent_id: string };
  identity: IdentityProfileData;
}
export interface MailAlias {
  email: string;
  display_name?: string;
  signature?: string;
}
export interface IntegrationAccount extends Record<string, unknown> {
  id?: string;
  email?: string;
  username?: string;
  name?: string;
  provider?: string;
  server_url?: string;
  password?: string;
  enabled?: boolean;
  display_name?: string;
  subject_prefix?: string;
  signature?: string;
  certificate?: string;
  aliases?: MailAlias[];
  imap_host?: string;
  imap_port?: string | number;
  imap_user?: string;
  imap_password?: string;
  imap_encryption?: string;
  smtp_host?: string;
  smtp_port?: string | number;
  smtp_user?: string;
  smtp_password?: string;
  smtp_encryption?: string;
}
export interface SettingsIntegrations extends Record<string, unknown> {
  calendars?: IntegrationAccount[];
  contacts?: IntegrationAccount[];
  mail_accounts?: IntegrationAccount[];
  emails?: IntegrationAccount[];
  default_calendar?: string;
  default_contacts?: string;
  default_mail?: string;
  vault_calendar?: Record<string, unknown> & { enabled_tables?: string[] };
  calendar_colors?: Record<string, string>;
}
export interface NewsletterDraft {
  mail_server: string;
  mail_port: number | string;
  mail_ssl: string;
  email: string;
  password?: string;
  delete_after_ingest: boolean;
}
export interface Snippet { id: string; title: string; content: string }
export interface TableColor { id: string; name: string; color: string }
export interface Confirmation { isOpen: boolean; title: string; message: string; onConfirm: () => void | Promise<void> }
export interface SettingsModel extends AiModelRegistryEntry {
  name: string;
  creator: string;
  profile: string;
  is_free: boolean;
  cost_in: number;
  cost_out: number;
}
export interface SettingsRegistryEntry extends Record<string, unknown> {
  id: string;
  name: string;
  color?: string;
  database_id?: string;
  folder?: string;
  properties?: { name: string; type?: string }[];
}
export type SettingsTables = SettingsRegistryEntry[];
export type SettingsDatabases = SettingsRegistryEntry[];
export type SettingsCalendars = Awaited<ReturnType<typeof fetchCalendarList>>['items'];
export type SettingsGraphNodes = Awaited<ReturnType<typeof fetchVaultGraph>>['nodes'];
export type Timer = ReturnType<typeof setTimeout> | undefined;
