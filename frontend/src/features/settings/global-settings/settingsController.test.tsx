import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalSettingsController, type SettingsController } from './useGlobalSettingsController';
import type { GlobalSettingsModalProps } from './types';
import { resetApiTestStorage } from '../../../../tests/api-request';
import { hydrateDraft, settingsAgents, settingsIntegrations } from './settingsDocuments';
import { GlobalSettingsView } from './GlobalSettingsView';
import { readStorage, themeKey, snippetsKey } from './settingsStorage';
import { queryClient } from '../../../shared/api/query-client';
import { settingsPanelLoaders } from './settingsPanelLoaders';
import { BUILTIN_PLUGINS } from '../../../shared/plugins/registry';

const translations = vi.hoisted(() => ({ t: (key: string) => key, i18n: { changeLanguage: vi.fn() } }));
const automationActions = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), run: vi.fn(), enablePlugin: vi.fn() }));
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => translations }));
vi.mock('../AI/useAIResources', () => ({ useAIResources: () => ({
  skills: [], tools: [], loading: false,
  automations: [{ id: 'fixture-automation', name: 'Fixture automation', agent_id: 'fixture-agent',
    skill_id: 'fixture-skill', instruction: 'Fixture instruction', enabled: false, interval_minutes: 60 }],
  saveAutomation: automationActions.save, deleteAutomation: automationActions.remove, runAutomation: automationActions.run,
}) }));
vi.mock('../../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({
  builtins: BUILTIN_PLUGINS.filter(plugin => plugin.id === 'automations'),
  loaded: true, loadError: false, isEnabled: (id: string) => id === 'automations',
  setPluginEnabled: automationActions.enablePlugin, reload: vi.fn(),
}) }));
vi.mock('../../../shared/api/plugins', async importOriginal => ({
  ...await importOriginal<typeof import('../../../shared/api/plugins')>(),
  fetchInstalledPlugins: vi.fn(() => Promise.resolve({ plugins: [] })),
  fetchPluginPermissionsCatalog: vi.fn(() => Promise.resolve({ apiVersion: 2, permissions: {} })),
}));
vi.mock('../../../shared/ui/filesystem-picker/FilesystemPickerModal', () => ({ FilesystemPickerModal: () => null }));
vi.mock('../AIModelComparisonModal', () => ({ default: () => null }));
vi.mock('../AIUsageHistoryModal', () => ({ default: () => null }));
vi.mock('../../vault-management/VaultSwitcher', () => ({ default: () => null }));
vi.mock('../../notion-import/NotionImportSettings', () => ({ default: () => null }));
vi.mock('../../mail/editor/Mail/MailBlockEditor', () => ({ default: () => null }));

const model = { provider: 'fixture', model_id: 'fixture-model', enabled: true, supports_tools: true, context_window: 32000, custom_capability: ['read'] };
const budget = { monthly_cost_cap: 2, enforce_block: false, preserved_policy: 'fixture' };
const usage = { budget, cap_ccy: 2, cap_usd: 2, currency: { symbol: '€', usd_rate: 1 }, over_cap: false, per_model: [], period: '2026-08', ratio: 0, spent_ccy: 0, spent_usd: 0 };
const account = { mail_server: 'fixture.invalid', mail_port: 110, mail_ssl: 'starttls', email: 'fixture@example.invalid', password_set: true, delete_after_ingest: true };
const agent = { id: 'fixture-agent', name: 'Fixture agent', provider: 'fixture', model: 'fixture-model', skill_ids: ['fixture-skill'], protected_extension: { keep: true } };
const configuration = { settings: { workspace_name: 'Fixture', theme: 'dark', custom_setting: 'keep' }, ai: { agents: [agent], active_agent_id: 'fixture-agent', providers: { fixture: { enabled: true, credential_ref: '__keychain__:fixture' } } }, graph: {}, paths: {} };
interface RecordedRequest { path: string; search: string; method: string; body: unknown }
let requests: RecordedRequest[];
let root: Root;
let container: HTMLDivElement;
let current: SettingsController | undefined;
let rejectWrites: boolean;
let configResponse: (() => Promise<Response>) | undefined;
let tableResponse: (() => Promise<Response>) | undefined;
let databaseRows: { id: string; name: string }[];

function snapshot(): SettingsController {
  if (!current) throw new Error('Controller not mounted');
  return current;
}
function Harness(props: GlobalSettingsModalProps & { showView?: boolean }) {
  const controller = useGlobalSettingsController(props);
  useLayoutEffect(() => { current = controller; });
  return props.showView ? <GlobalSettingsView context={controller} /> : null;
}
async function mount(props: Partial<GlobalSettingsModalProps> = {}) {
  await act(async () => { root.render(<Harness isOpen onClose={vi.fn()} {...props} />); await Promise.resolve(); });
}
async function advance(milliseconds = 800) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}
function writes() { return requests.filter(request => request.method !== 'GET'); }

beforeAll(async () => {
  // These integration cases render real editors. Transform their module graphs
  // before fake timers/act start so a slow test compiler cannot strand an act
  // scope and invalidate the following persistence tests. No editor is mounted.
  await Promise.all([
    settingsPanelLoaders.accounts(),
    settingsPanelLoaders.reader(),
    settingsPanelLoaders.graph(),
    settingsPanelLoaders.ai(),
    settingsPanelLoaders.plugins(),
  ]);
}, 30_000);

beforeEach(() => {
  queryClient.clear();
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetApiTestStorage();
  requests = [];
  rejectWrites = false;
  configResponse = undefined;
  tableResponse = undefined;
  databaseRows = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    const text = request.method === 'GET' ? '' : await request.clone().text();
    const body: unknown = text ? JSON.parse(text) : null;
    requests.push({ path, search: new URL(request.url).search, method: request.method, body });
    if (rejectWrites && request.method !== 'GET') return Response.json({ detail: 'Fixture failure' }, { status: 500 });
    if (path === '/api/config/editor' && request.method === 'GET' && configResponse) return configResponse();
    if (path === '/api/vault/tables' && tableResponse) return tableResponse();
    const payloads: Record<string, unknown> = {
      '/api/config/editor': configuration,
      '/api/integrations': { mail_accounts: [], contacts: [], calendars: [], extension: { keep: true } },
      '/api/identity': { full_name: 'Fixture identity', email: 'fixture@example.invalid', address: null },
      '/api/ai/catalog': { config: { providers: { fixture: { enabled: true } } }, catalog: { providers: [] } },
      '/api/ai/models': { configured_models: [model], models: [model], budget, currency: usage.currency },
      '/api/ai/model-comparison': { models: [] },
      '/api/ai/usage': usage,
      '/api/vault/tables': [],
      '/api/vault/databases': databaseRows,
      '/api/graph': { nodes: [], edges: [] },
      '/api/auth/google/status': { configured: false },
      '/api/reader/sources': [],
      '/api/reader/newsletter-account': account,
      '/api/social/networks': [{ id: 'mastodon', name: 'Mastodon', icon: '🐘', enabled: true }],
      '/api/social/streams': [],
      '/api/credentials/deepl_api_key': { has_value: true },
      '/api/env': { SOFTCATALA_API_URL: 'https://fixture.invalid/translate' },
    };
    if (request.method !== 'GET') return Response.json({ status: 'success', success: true, ...account });
    if (!(path in payloads)) throw new Error(`Unexpected fixture request ${path}`);
    return Response.json(payloads[path]);
  }));
});
afterEach(() => {
  act(() => { root.unmount(); });
  queryClient.clear();
  container.remove();
  current = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  resetApiTestStorage();
  vi.unstubAllGlobals();
});

describe('settings controller persistence contracts', () => {
  it('opens the populated automation editor through the real plugin configure action without writing', async () => {
    await act(async () => {
      root.render(<Harness isOpen onClose={vi.fn()} initialTab="plugins" showView />);
      await Promise.resolve();
      await vi.dynamicImportSettled();
    });
    await advance();
    const configure = container.querySelector<HTMLButtonElement>(
      '#settings-plugin-automations button[aria-label="settings.plugins.configure"]',
    );
    expect(configure).not.toBeNull();
    await act(async () => {
      configure?.click();
      await vi.dynamicImportSettled();
    });
    await advance();
    expect(snapshot().activeTab).toBe('ai');
    expect(snapshot().aiSection).toBe('automations');
    expect(container.querySelector('.settings-sidebar__item.active')?.textContent).toContain('settings.tabs.ai');
    expect(container.querySelector('.settings-section-tabs button[aria-current="page"]')?.textContent)
      .toContain('settings.ai.operations.automations_tab');
    expect(container.querySelector('.settings-main')?.textContent).toContain('Fixture automation');
    expect(writes()).toEqual([]);
    expect(automationActions.enablePlugin).not.toHaveBeenCalled();
    expect(automationActions.save).not.toHaveBeenCalled();
    expect(automationActions.run).not.toHaveBeenCalled();
    expect(automationActions.remove).not.toHaveBeenCalled();
  });

  it('hydrates once under StrictMode and reads again after closing and reopening without saving', async () => {
    const setOpen = async (isOpen: boolean) => {
      await act(async () => {
        root.render(<React.StrictMode><Harness isOpen={isOpen} onClose={vi.fn()} initialTab="plugins" /></React.StrictMode>);
        await Promise.resolve();
      });
      await advance();
    };
    await setOpen(true);
    expect(requests.map(request => request.path).sort()).toEqual([
      '/api/config/editor', '/api/identity', '/api/integrations',
    ]);
    expect(snapshot().draft.identity.full_name).toBe('Fixture identity');
    expect(writes()).toEqual([]);

    await setOpen(false);
    configResponse = () => Promise.resolve(Response.json({
      ...configuration, settings: { ...configuration.settings, workspace_name: 'Changed elsewhere' },
    }));
    await setOpen(true);
    expect(requests.filter(request => request.method === 'GET').map(request => request.path).sort()).toEqual([
      '/api/config/editor', '/api/config/editor', '/api/identity', '/api/identity', '/api/integrations', '/api/integrations',
    ]);
    expect(snapshot().draft.settings.workspace_name).toBe('Changed elsewhere');
    expect(writes()).toEqual([]);
  });
  it('loads plugin settings without requesting auxiliary data for other sections', async () => {
    await mount({ initialTab: 'plugins' });
    await advance();
    expect(requests.map(request => request.path).sort()).toEqual([
      '/api/config/editor', '/api/identity', '/api/integrations',
    ]);
    expect(writes()).toEqual([]);
    act(() => { snapshot().setActiveTab('calendar'); });
    await advance();
    expect(requests.some(request => request.path === '/api/vault/tables')).toBe(true);
    act(() => { snapshot().setActiveTab('plugins'); });
    act(() => { snapshot().setActiveTab('calendar'); });
    await advance();
    expect(requests.filter(request => request.path === '/api/vault/tables')).toHaveLength(1);
    expect(writes()).toEqual([]);
  });
  it('loads databases while tables are still pending and keeps their result if tables fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    databaseRows = [{ id: 'fixture-database', name: 'Fixture database' }];
    let release: ((response: Response) => void) | undefined;
    tableResponse = () => new Promise(resolve => { release = resolve; });
    await mount({ initialTab: 'calendar' });
    await advance();
    expect(requests.filter(request => request.path === '/api/vault/tables')).toHaveLength(1);
    expect(requests.filter(request => request.path === '/api/vault/databases')).toHaveLength(1);
    expect(snapshot().databases).toEqual(databaseRows);
    await act(async () => {
      release?.(Response.json({ detail: 'Temporary table failure' }, { status: 503 }));
      await Promise.resolve();
    });
    await advance();
    expect(snapshot().databases).toEqual(databaseRows);
    expect(writes()).toEqual([]);
  });
  it.each(['general', 'appearance', 'language', 'mail', 'reader', 'graph', 'ai'])('renders the %s pane in the original modal shell', async initialTab => {
    await act(async () => { root.render(<Harness isOpen onClose={vi.fn()} initialTab={initialTab} showView />); await Promise.resolve(); });
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(container.querySelector('[role=dialog][aria-labelledby=settings-modal-title]')).not.toBeNull();
    expect(container.querySelector('.settings-sidebar')).not.toBeNull();
    expect(container.querySelector('.settings-main')).not.toBeNull();
    expect(container.querySelector('.settings-section')).not.toBeNull();
    expect(container.querySelectorAll('.settings-sidebar__item.active')).toHaveLength(1);
    expect(snapshot().activeTab).toBe(initialTab);
  });
  it('hydrates independent documents without saving placeholder state', async () => {
    await mount();
    await advance();
    expect(snapshot().draft.ai.agents).toEqual([agent]);
    expect(snapshot().draft.ai.providers).toEqual(configuration.ai.providers);
    expect(snapshot().draft.identity.full_name).toBe('Fixture identity');
    expect(snapshot().draft.identity.address).toBeNull();
    expect(readStorage(themeKey)).toBe('dark');
    expect(writes()).toEqual([]);
    expect(requests.some(request => request.path === '/api/ai/catalog')).toBe(false);
    act(() => { snapshot().setDraft(previous => ({ ...previous, settings: { ...previous.settings, workspace_name: 'Changed' } })); });
    await advance();
    expect(writes().map(request => request.path)).toEqual(['/api/config', '/api/integrations/bulk', '/api/identity']);
    expect(writes()[0]?.body).toMatchObject({ settings: { workspace_name: 'Changed', custom_setting: 'keep' }, ai: { agents: [agent], providers: { fixture: { enabled: true } } } });
    expect(writes()[1]?.body).toMatchObject({ extension: { keep: true } });
    expect(writes()[2]?.body).toMatchObject({ address: null });
  });
  it('does not save during or after slow initial configuration loading', async () => {
    let release: ((response: Response) => void) | undefined;
    configResponse = () => new Promise(resolve => { release = resolve; });
    await mount();
    await advance(1600);
    expect(writes()).toEqual([]);
    await act(async () => { release?.(Response.json(configuration)); await Promise.resolve(); });
    expect(snapshot().draft.ai.agents).toEqual([agent]);
    await advance(1600);
    expect(writes()).toEqual([]);
    await act(async () => { await snapshot().handleClose(); });
    expect(writes()).toEqual([]);
  });
  it('flushes changes exactly once on close and cancels pending autosave', async () => {
    const close = vi.fn();
    await mount({ onClose: close });
    await advance();
    act(() => { snapshot().setDraft(previous => ({ ...previous, settings: { ...previous.settings, workspace_name: 'Before close' } })); });
    await act(async () => { await snapshot().handleClose(); });
    await advance(1600);
    expect(close).toHaveBeenCalledOnce();
    expect(writes()).toHaveLength(3);
    expect(writes()[0]?.body).toMatchObject({ settings: { workspace_name: 'Before close' } });
  });
  it('still closes after a failed flush', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const close = vi.fn();
    await mount({ onClose: close });
    await advance();
    act(() => { snapshot().setDraft(previous => ({ ...previous, settings: { ...previous.settings, workspace_name: 'Failed save' } })); });
    rejectWrites = true;
    await act(async () => { await snapshot().handleClose(); });
    expect(close).toHaveBeenCalledOnce();
    expect(snapshot().isSaving).toBe(false);
  });
  it('omits an untouched POP3 password and includes an edited one', async () => {
    await mount({ initialTab: 'reader' });
    await advance();
    act(() => { snapshot().setNewsletterAccount(previous => ({ ...previous, mail_server: 'other.invalid' })); });
    await advance();
    expect(writes().find(request => request.path === '/api/reader/newsletter-account')?.body).toEqual({ mail_server: 'other.invalid', mail_port: 110, mail_ssl: 'starttls', email: 'fixture@example.invalid', delete_after_ingest: true });
    requests = [];
    act(() => { snapshot().setNewsletterAccount(previous => ({ ...previous, password: 'new-fixture-password' })); snapshot().setNewsletterPasswordDirty(true); });
    await advance();
    expect(writes().find(request => request.path === '/api/reader/newsletter-account')?.body).toMatchObject({ password: 'new-fixture-password' });
  });
  it('preserves complete model rows and unrelated budget metadata', async () => {
    await mount({ initialTab: 'ai' });
    await act(async () => { await snapshot().saveAiBudget('5.25', true); });
    expect(writes().find(request => request.path === '/api/ai/models')?.body).toEqual({ models: [model], budget: { ...budget, monthly_cost_cap: 5.25, enforce_block: true } });
  });
  it('keeps newsletter routing and clears editors when switching tabs', async () => {
    await mount({ initialTab: 'newsletters' });
    expect(snapshot().activeTab).toBe('reader');
    expect(snapshot().readerSection).toBe('subscriptions');
    act(() => { snapshot().setEditingSnippetId('fixture-snippet'); snapshot().setEditingAgent(agent); snapshot().setEditingAccountId('fixture-account'); });
    act(() => { snapshot().setActiveTab('general'); });
    expect(snapshot().editingSnippetId).toBeNull();
    expect(snapshot().editingAgent).toBeNull();
    expect(snapshot().editingAccountId).toBeNull();
  });
  it('persists snippet edits with stable identifiers and exact content', async () => {
    await mount({ isOpen: false });
    act(() => { snapshot().setSnippetDraft({ title: 'Fixture', content: 'First\nSecond 🧠' }); });
    act(() => { snapshot().handleAddSnippet(); });
    const saved = snapshot().snippets.at(-1);
    expect(saved).toMatchObject({ title: 'Fixture', content: 'First\nSecond 🧠' });
    expect(readStorage(snippetsKey)).toEqual(snapshot().snippets);
    expect(writes()).toEqual([]);
  });
  it('restores social state when an optimistic write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount({ initialTab: 'social' });
    const previous = snapshot().socialNetworks;
    rejectWrites = true;
    await act(async () => { await snapshot().saveSocialNetworks(previous.map(network => ({ ...network, enabled: false }))); });
    expect(snapshot().socialNetworks).toEqual(previous);
  });
  it('keeps syncing legacy accounts without an id and preserves query-only mail requests', async () => {
    await mount();
    await advance();
    await act(async () => { await snapshot().handleSyncAccount('mail', { email: 'legacy@example.invalid' }); });
    expect(writes()).toEqual([{ method: 'POST', path: '/api/mail/sync', search: '?email=legacy%40example.invalid&limit=50', body: null }]);
    expect(snapshot().syncingAccounts['[object Object]']).toBe(false);
  });
  it('debounces translation changes and never resends the stored credential', async () => {
    await mount({ initialTab: 'translate' });
    await advance(1600);
    expect(writes()).toEqual([]);
    expect(snapshot().translateState.deepl_input).toBe('');
    act(() => { snapshot().setTranslateState(previous => ({ ...previous, deepl_input: ' fixture-secret ' })); });
    await advance(1199);
    expect(writes()).toEqual([]);
    await advance(1);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ method: 'POST', path: '/api/credentials/', body: { key: 'deepl_api_key', value: 'fixture-secret' } });
    expect(snapshot().translateState.deepl_input).toBe('');
  });
  it('validates dynamic documents and preserves plugin and provider extensions', async () => {
    await mount({ isOpen: false });
    const draft = hydrateDraft(snapshot().draft, configuration);
    expect(draft.settings.custom_setting).toBe('keep');
    expect(settingsAgents([agent])).toEqual([agent]);
    const integrations = { calendars: [{ id: 'fixture-calendar', email: 'fixture@example.invalid', provider_extension: 7 }], custom: ['kept'] };
    expect(settingsIntegrations(integrations)).toBe(integrations);
    expect(() => settingsAgents([{ id: 7 }])).toThrow();
    expect(() => settingsIntegrations({ calendars: [{ email: 7 }] })).toThrow();
    expect(() => hydrateDraft(snapshot().draft, { graph: { physics: 'invalid' } })).toThrow();
  });
});
