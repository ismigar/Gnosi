import { agent, budget, configuration, createSettingsApiFixture, model, type SettingsApiFixture } from './__fixtures__/settingsController';
import { AgentsPanel } from './AgentsPanel';
import { MemoryRouter, useLocation } from 'react-router-dom';
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalSettingsController, type SettingsController } from './useGlobalSettingsController';
import type { GlobalSettingsModalProps } from './types';
import { resetApiTestStorage } from '../../../../tests/api-request';
import { hydrateDraft, settingsAgents, settingsIntegrations } from './settingsDocuments';
import { GlobalSettingsView } from './GlobalSettingsView';
import { ModelBudget } from './ModelBudget';
import { readStorage, themeKey, snippetsKey } from './settingsStorage';
import { queryClient } from '../../../shared/api/query-client';
import { settingsPanelLoaders } from './settingsPanelLoaders';
import { BUILTIN_PLUGINS } from '../../../shared/plugins/registry';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';

const translations = vi.hoisted(() => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }));
const automationActions = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), run: vi.fn(), enablePlugin: vi.fn() }));
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => translations }));
vi.mock('../AI/useAIResources', () => ({ useAIResources: () => ({
  skills: [], tools: [], loading: false,
  automations: [{ id: 'fixture-automation', name: 'Fixture automation', agent_id: 'fixture-agent',
    skill_id: 'fixture-skill', instruction: 'Fixture instruction', enabled: false, interval_minutes: 60 }],
  saveAutomation: automationActions.save, deleteAutomation: automationActions.remove, runAutomation: automationActions.run,
}) }));
vi.mock('../../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({
  builtins: BUILTIN_PLUGINS.filter(plugin => ['automations', 'resources'].includes(plugin.id)),
  loaded: true, loadError: false, isEnabled: (id: string) => ['automations', 'resources'].includes(id),
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
vi.mock('../../literature/settings/ResourcesPluginConfig', () => ({
  default: () => <div data-testid="resources-plugin-editor">Fixture references editor</div>,
}));

let api: SettingsApiFixture;
let root: Root;
let container: HTMLDivElement;
let current: SettingsController | undefined;

function snapshot(): SettingsController {
  if (!current) throw new Error('Controller not mounted');
  return current;
}
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname + location.search}</output>; }
function Harness(props: GlobalSettingsModalProps & { showView?: boolean; showAgents?: boolean; showBudget?: boolean }) {
  const controller = useGlobalSettingsController(props);
  useLayoutEffect(() => { current = controller; });
  if (props.showAgents) return <AgentsPanel context={controller} />;
  if (props.showBudget) return <ModelBudget context={controller} />;
  return props.showView ? <MemoryRouter><GlobalSettingsView context={controller} /><LocationProbe /></MemoryRouter> : null;
}
async function mount(props: Partial<GlobalSettingsModalProps> = {}) {
  await act(async () => { root.render(<Harness isOpen onClose={vi.fn()} {...props} />); await Promise.resolve(); });
}
async function advance(milliseconds = 800) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}
function writes() { return api.requests.filter(request => request.method !== 'GET'); }

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
    import('../../literature/settings/ResourcesPluginConfig'),
  ]);
}, 30_000);

beforeEach(() => {
  queryClient.clear();
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetApiTestStorage();
  api = createSettingsApiFixture();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(api.fetch));
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
  it('scrolls the form from toggles and focuses reading areas without activating controls', async () => {
    await act(async () => { root.render(<Harness isOpen onClose={vi.fn()} initialTab="general" showView />); await Promise.resolve(); });
    const main = container.querySelector<HTMLElement>('.settings-main');
    if (!main) throw new Error('Missing settings form');
    const toggle = document.createElement('button');
    toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', 'false');
    const text = document.createElement('p'); text.textContent = 'Explanation';
    main.append(toggle, text);
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => { document.activeElement?.dispatchEvent(event); });
      return event;
    };
    toggle.focus();
    expect(press('ArrowDown').defaultPrevented).toBe(true);
    expect(main.scrollTop).toBe(40);
    expect(press(' ').defaultPrevented).toBe(false);
    act(() => { text.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })); });
    expect(document.activeElement).toBe(main);
    expect(press('ArrowDown').defaultPrevented).toBe(true);
    expect(main.scrollTop).toBe(80);
    toggle.remove(); text.remove();
  });
  it('refreshes the connected account on return from Google while preserving the open form', async () => {
    await mount({ initialTab: 'calendar' });
    act(() => {
      snapshot().setAddAccountEmail('user+calendar@example.test');
      snapshot().setAddAccountType('calendar');
    });
    const draftBefore = snapshot().draft;
    api.integrationPayload = {
      ...api.integrationPayload,
      calendars: [{ id: 'google_fixture', provider: 'google', email: 'user+calendar@example.test' }],
    };
    await act(async () => {
      dispatchWindowEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(snapshot().integrations.calendars).toEqual(api.integrationPayload.calendars);
    expect(snapshot().activeTab).toBe('calendar');
    expect(snapshot().addAccountEmail).toBe('user+calendar@example.test');
    expect(snapshot().addAccountType).toBe('calendar');
    expect(snapshot().draft).toEqual(draftBefore);
  });

  it('shows one list with a principal choice on each profile', async () => {
    await act(async () => { root.render(<Harness isOpen onClose={vi.fn()} initialTab="ai" showAgents />); await Promise.resolve(); });
    act(() => { snapshot().setDraft(previous => ({ ...previous, ai: { ...previous.ai, agents: [...previous.ai.agents, { ...agent, id: 'other-profile', name: 'Other profile' }] } })); });
    expect(container.textContent).toContain('Fixture agent');
    expect(container.textContent).toContain('Other profile');
    const promote = [...container.querySelectorAll('button')].find(button => button.textContent.includes('make_principal'));
    if (!promote) throw new Error('Missing principal selection');
    act(() => { promote.click(); });
    expect(snapshot().draft.ai.active_agent_id).toBe('other-profile');
    expect(snapshot().draft.ai.agents).toHaveLength(2);
    expect(snapshot().draft.ai.agents[0]?.protected_extension).toEqual({ keep: true });
  });

  it('deletes only the confirmed additional profile and persists the principal unchanged', async () => {
    await mount();
    await advance();
    const extra = { ...agent, id: 'extra', name: 'Saved profile' };
    act(() => { snapshot().setDraft(previous => ({ ...previous, ai: { ...previous.ai, agents: [agent, extra] } })); });
    await advance();
    api.requests = [];
    act(() => { snapshot().handleDeleteAIAgent(extra); });
    expect(snapshot().confirmConfig.title).toBe('settings.ai.assistant.delete_profile_title');
    expect(snapshot().draft.ai.agents).toHaveLength(2);
    await act(async () => { await snapshot().confirmConfig.onConfirm(); });
    await advance();
    expect(snapshot().draft.ai.agents).toEqual([agent]);
    expect(writes().find(request => request.path === '/api/config')?.body).toMatchObject({ ai: {
      agents: [agent], active_agent_id: agent.id,
    } });
  });

  it('protects the principal and managed profiles, including a principal changed during confirmation', async () => {
    await mount();
    const extra = { ...agent, id: 'extra' };
    act(() => { snapshot().handleDeleteAIAgent(agent); });
    expect(snapshot().confirmConfig.isOpen).toBe(false);
    act(() => { snapshot().handleDeleteAIAgent({ ...extra, managed_by: 'plugin' }); });
    expect(snapshot().confirmConfig.isOpen).toBe(false);
    act(() => { snapshot().setDraft(previous => ({ ...previous, ai: { ...previous.ai, agents: [agent, extra] } })); });
    act(() => { snapshot().handleDeleteAIAgent(extra); });
    act(() => { snapshot().setDraft(previous => ({ ...previous, ai: { ...previous.ai, active_agent_id: extra.id } })); });
    await act(async () => { await snapshot().confirmConfig.onConfirm(); });
    expect(snapshot().draft.ai.agents).toEqual([agent, extra]);
  });

  it('redirects the automation plugin configure action to activity without writing', async () => {
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
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/dashboard?tab=schedulers&kind=personal');
    expect(writes()).toEqual([]);
    expect(automationActions.enablePlugin).not.toHaveBeenCalled();
    expect(automationActions.save).not.toHaveBeenCalled();
    expect(automationActions.run).not.toHaveBeenCalled();
    expect(automationActions.remove).not.toHaveBeenCalled();
  });

  it.each(['references', 'plugins'])('opens the %s references entry as a dedicated screen with the common return action', async entryTab => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    try {
      await act(async () => {
        root.render(<Harness isOpen onClose={vi.fn()} initialTab="plugins" showView />);
        await vi.dynamicImportSettled();
      });
      await advance();
      expect(container.querySelector('[data-testid="resources-plugin-editor"]')).toBeNull();
      await act(async () => {
        root.render(<Harness isOpen onClose={vi.fn()} initialTab={entryTab} initialPluginId={entryTab === 'plugins' ? 'resources' : null} showView />);
        await Promise.resolve();
      });
      await advance();
      await act(async () => { await vi.dynamicImportSettled(); });
      expect(snapshot().activeTab).toBe(entryTab === 'plugins' ? 'resources' : 'references');
      expect(container.querySelector('.settings-sidebar__item.active')?.textContent).toContain('settings.tabs.plugins');
      expect(container.querySelector('#settings-plugin-resources')).toBeNull();
      expect(container.querySelectorAll('[data-testid="resources-plugin-editor"]')).toHaveLength(1);
      const back = container.querySelector<HTMLButtonElement>('.settings-content-wrap > button');
      expect(back?.textContent).toContain('settings.tabs.plugins');
      await act(async () => { back?.click(); await vi.dynamicImportSettled(); });
      await advance();
      expect(snapshot().activeTab).toBe('plugins');
      expect(container.querySelector('[data-testid="resources-plugin-editor"]')).toBeNull();
      expect(container.querySelector('#settings-plugin-resources')).not.toBeNull();
      expect(writes()).toEqual([]);
      expect(automationActions.enablePlugin).not.toHaveBeenCalled();
    } finally {
      if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
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
    expect(api.requests.map(request => request.path).sort()).toEqual([
      '/api/config/editor', '/api/identity', '/api/integrations',
    ]);
    expect(snapshot().draft.identity.full_name).toBe('Fixture identity');
    expect(writes()).toEqual([]);

    await setOpen(false);
    api.configResponse = () => Promise.resolve(Response.json({
      ...configuration, settings: { ...configuration.settings, workspace_name: 'Changed elsewhere' },
    }));
    await setOpen(true);
    expect(api.requests.filter(request => request.method === 'GET').map(request => request.path).sort()).toEqual([
      '/api/config/editor', '/api/config/editor', '/api/identity', '/api/identity', '/api/integrations', '/api/integrations',
    ]);
    expect(snapshot().draft.settings.workspace_name).toBe('Changed elsewhere');
    expect(writes()).toEqual([]);
  });
  it('loads plugin settings without requesting auxiliary data for other sections', async () => {
    await mount({ initialTab: 'plugins' });
    await advance();
    expect(api.requests.map(request => request.path).sort()).toEqual([
      '/api/config/editor', '/api/identity', '/api/integrations',
    ]);
    expect(writes()).toEqual([]);
    act(() => { snapshot().setActiveTab('calendar'); });
    await advance();
    expect(api.requests.some(request => request.path === '/api/vault/tables')).toBe(true);
    act(() => { snapshot().setActiveTab('plugins'); });
    act(() => { snapshot().setActiveTab('calendar'); });
    await advance();
    expect(api.requests.filter(request => request.path === '/api/vault/tables')).toHaveLength(1);
    expect(writes()).toEqual([]);
  });
  it('loads databases while tables are still pending and keeps their result if tables fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.databaseRows = [{ id: 'fixture-database', name: 'Fixture database' }];
    let release: ((response: Response) => void) | undefined;
    api.tableResponse = () => new Promise(resolve => { release = resolve; });
    await mount({ initialTab: 'calendar' });
    await advance();
    expect(api.requests.filter(request => request.path === '/api/vault/tables')).toHaveLength(1);
    expect(api.requests.filter(request => request.path === '/api/vault/databases')).toHaveLength(1);
    expect(snapshot().databases).toEqual(api.databaseRows);
    await act(async () => {
      release?.(Response.json({ detail: 'Temporary table failure' }, { status: 503 }));
      await Promise.resolve();
    });
    await advance();
    expect(snapshot().databases).toEqual(api.databaseRows);
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
    expect(api.requests.some(request => request.path === '/api/ai/catalog')).toBe(false);
    act(() => { snapshot().setDraft(previous => ({ ...previous, settings: { ...previous.settings, workspace_name: 'Changed' } })); });
    await advance();
    expect(writes().map(request => request.path)).toEqual(['/api/config', '/api/integrations/bulk', '/api/identity']);
    expect(writes()[0]?.body).toMatchObject({ settings: { workspace_name: 'Changed', custom_setting: 'keep' }, ai: { agents: [agent], providers: { fixture: { enabled: true } } } });
    expect(writes()[1]?.body).toMatchObject({ extension: { keep: true } });
    expect(writes()[2]?.body).toMatchObject({ address: null });
  });
  it('does not save during or after slow initial configuration loading', async () => {
    let release: ((response: Response) => void) | undefined;
    api.configResponse = () => new Promise(resolve => { release = resolve; });
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
    api.rejectWrites = true;
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
    api.requests = [];
    act(() => { snapshot().setNewsletterAccount(previous => ({ ...previous, password: 'new-fixture-password' })); snapshot().setNewsletterPasswordDirty(true); });
    await advance();
    expect(writes().find(request => request.path === '/api/reader/newsletter-account')?.body).toMatchObject({ password: 'new-fixture-password' });
  });
  it('preserves complete model rows and unrelated budget metadata', async () => {
    await mount({ initialTab: 'ai' });
    await act(async () => { await snapshot().saveAiBudget('5.25', true); });
    expect(writes().find(request => request.path === '/api/ai/models')?.body).toEqual({ models: [model], budget: { ...budget, monthly_cost_cap: 5.25, enforce_block: true } });
  });
  it.each(['click', ' ', 'Enter'])('persists both monthly blocking states with %s and restores them on reopening', async activation => {
    api.savedBudget = { ...budget, enforce_block: true };
    const reopen = async () => {
      act(() => { root.render(null); });
      await act(async () => { root.render(<Harness isOpen onClose={vi.fn()} initialTab="ai" showBudget />); await Promise.resolve(); });
    };
    await reopen();
    for (const enabled of [false, true]) {
      const toggle = container.querySelector<HTMLElement>('[role="switch"]');
      if (!toggle) throw new Error('Missing monthly blocking switch');
      expect(toggle.getAttribute('aria-checked')).toBe(String(!enabled));
      api.requests = [];
      await act(async () => {
        if (activation === 'click') toggle.click();
        else toggle.dispatchEvent(new KeyboardEvent('keydown', { key: activation, bubbles: true, cancelable: true }));
        await Promise.resolve();
      });
      expect(writes()).toEqual([{ path: '/api/ai/models', search: '', method: 'PUT', body: {
        models: [model], budget: { ...budget, enforce_block: enabled },
      } }]);
      await reopen();
      expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe(String(enabled));
      expect(snapshot().enforceBlock).toBe(enabled);
    }
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
    api.rejectWrites = true;
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
  it('opens translation settings without reading or saving retired provider credentials', async () => {
    await mount({ initialTab: 'translate' });
    await advance(1600);
    expect(writes()).toEqual([]);
    expect(api.requests.some(request => request.path.startsWith('/api/credentials') || request.path === '/api/env')).toBe(false);
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
