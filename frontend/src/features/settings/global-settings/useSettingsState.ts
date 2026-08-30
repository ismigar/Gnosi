import type { SettingsDraft, SettingsIntegrations, SettingsCalendars, SettingsDatabases, SettingsTables, SettingsGraphNodes, SettingsModel, AgentDraft, Confirmation, TableColor, Timer, SettingsTranslate } from './types';
import type { AiUsage } from '../../../shared/api/ai';
import { useApi } from '../../../shared/api/use-api';
import { useCallback } from 'react';
import { useRef } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GlobalSettingsModalProps } from './types';

export function useSettingsState(props: GlobalSettingsModalProps) {
  const { initialTab = "general", initialPluginId = null } = props;
  const { t, i18n } = useTranslation();
  const { role } = useApi();
  const tn = useCallback<SettingsTranslate>((k, opts) => t('settings.' + k, opts), [t]);
  const [draft, setDraft] = useState<SettingsDraft>({
    settings: {
      user_name: '', workspace_name: '', gnosi_mode: 'personal',
      org_user: '', org_password: '', org_workspace: '',
      language: 'ca', week_start: 1, currency: 'EUR (€)', decimal_symbol: ',', date_format: 'locale',
      theme: 'system', reduce_animations: false,
      reader: { podcast: { provider: '', model: '' } }
    },
    paths: { vault: '', databases: '', newsletters: '' },
    graph: {
      visible_databases: [], visible_tables: [], visible_fields: [],
      show_arrows: true, label_threshold: 10, node_size: 1.0, edge_thickness: 1.0,
      physics: { gravity: 0.1, repulsion: 1000, friction: 10 }
    },
    ai: { agents: [], providers: {}, active_agent_id: '' },
    identity: {
      full_name: '', first_name: '', last_name: '', email: '',
      phone: '', address: '', city: '', zip_code: '', dni_nie: '', notes: ''
    }
  });
  const [activeTab, setActiveTab] = useState(
    initialTab === 'newsletters' ? 'reader' : initialTab,
  );
  const [readerSection, setReaderSection] = useState(
    initialTab === 'newsletters' ? 'subscriptions' : 'podcast',
  );
  const [aiSection, setAiSection] = useState('agents');
  const [generalSection, setGeneralSection] = useState('system');
  const [mailSection, setMailSection] = useState('accounts');
  const [graphSection, setGraphSection] = useState('engine');
  const [socialSection, setSocialSection] = useState('networks');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(
    () => ['api', 'plugins'].includes(initialTab) || Boolean(initialPluginId)
  );
  const [integrations, setIntegrations] = useState<SettingsIntegrations>({ calendars: [], contacts: [], mail_accounts: [] });
  const configLoadedRef = useRef(false);
  const aiCatalogLoadedRef = useRef(false);
  const integrationsLoadedRef = useRef(false);
  const identityLoadedRef = useRef(false);
  const hydrationGenerationRef = useRef(0);
  const [googleSubCalendars, setGoogleSubCalendars] = useState<SettingsCalendars>([]);
  const [databases, setDatabases] = useState<SettingsDatabases>([]);
  const [tables, setTables] = useState<SettingsTables>([]);
  const [graphNodes, setGraphNodes] = useState<SettingsGraphNodes | null>(null);
  const [graphNodesLoading, setGraphNodesLoading] = useState(false);
  const graphNodesFetchedRef = useRef(false);
  const [aiRegistry, setAiRegistry] = useState<SettingsModel[]>([]);
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const [isUsageHistoryOpen, setIsUsageHistoryOpen] = useState(false);
  const [monthlyCostCap, setMonthlyCostCap] = useState<string | number>('');
  const [enforceBlock, setEnforceBlock] = useState(false);
  const [savingBudget, setSavingBudget] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [translateState, setTranslateState] = useState({
    deepl_has_value: false,    // GET /api/credentials/deepl_api_key.has_value
    deepl_input: '',           // new value pending save (never pre-populated)
    softcatala_url: '',        // current value of SOFTCATALA_API_URL in local .env
    loading: false,
    saving_deepl: false,
    saving_softcatala: false,
    saved_deepl: false,        // transient "saved" indicator after a successful autosave
    saved_softcatala: false,
  });
  const deeplAutoSaveRef = useRef<Timer>(undefined);
  const softcatalaAutoSaveRef = useRef<Timer>(undefined);
  const softcatalaBaselineRef = useRef<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerField, setPickerField] = useState<string | null>(null);
  const [, setGoogleAuthConfigured] = useState(false);
  const [googleCalAuthError, setGoogleCalAuthError] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDraft | null>(null);
  const [agentEditorTarget, setAgentEditorTarget] = useState<HTMLDivElement | null>(null);
  const [isModelComparisonOpen, setIsModelComparisonOpen] = useState(false);
  const autoSaveTimeoutRef = useRef<Timer>(undefined);
  const lastSavedDataRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [, setSavingStatus] = useState('idle');
  const [confirmConfig, setConfirmConfig] = useState<Confirmation>({ isOpen: false, title: '', message: '', onConfirm: () => { } });
  const [isAddingTable, setIsAddingTable] = useState(false);
  const [editingTableColor, setEditingTableColor] = useState<TableColor | null>(null);
  const [isDatabasesExpanded, setIsDatabasesExpanded] = useState(true);
  const [isSystemEntitiesExpanded, setIsSystemEntitiesExpanded] = useState(true);
  return {
    t, i18n, role, tn, draft, setDraft,
    activeTab, setActiveTab, readerSection, setReaderSection, aiSection, setAiSection,
    generalSection, setGeneralSection, mailSection, setMailSection, graphSection, setGraphSection,
    socialSection, setSocialSection, isAdvancedOpen, setIsAdvancedOpen, integrations, setIntegrations,
    configLoadedRef, aiCatalogLoadedRef, integrationsLoadedRef, identityLoadedRef, hydrationGenerationRef, googleSubCalendars,
    setGoogleSubCalendars, databases, setDatabases, tables, setTables, graphNodes,
    setGraphNodes, graphNodesLoading, setGraphNodesLoading, graphNodesFetchedRef, aiRegistry, setAiRegistry,
    aiUsage, setAiUsage, isUsageHistoryOpen, setIsUsageHistoryOpen, monthlyCostCap, setMonthlyCostCap,
    enforceBlock, setEnforceBlock, savingBudget, setSavingBudget, isSaving, setIsSaving,
    translateState, setTranslateState, deeplAutoSaveRef, softcatalaAutoSaveRef, softcatalaBaselineRef, pickerOpen,
    setPickerOpen, pickerField, setPickerField, setGoogleAuthConfigured, googleCalAuthError, setGoogleCalAuthError,
    editingAgent, setEditingAgent, agentEditorTarget, setAgentEditorTarget, isModelComparisonOpen, setIsModelComparisonOpen,
    autoSaveTimeoutRef, lastSavedDataRef, panelRef, setSavingStatus, confirmConfig, setConfirmConfig,
    isAddingTable, setIsAddingTable, editingTableColor, setEditingTableColor, isDatabasesExpanded, setIsDatabasesExpanded,
    isSystemEntitiesExpanded, setIsSystemEntitiesExpanded,
  };
}
