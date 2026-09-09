import { createInstance } from 'i18next';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsSidebar } from './SettingsSidebar';
import { pluginForSettingsTab } from './pluginSettingsNavigation';

const translations = createInstance();
void translations.init({
  lng: 'en', keySeparator: false,
  resources: { en: { translation: Object.fromEntries(
    ['general', 'appearance', 'language', 'profile', 'account', 'workspace', 'plugins', 'graph']
      .map(tab => [`settings.tabs.${tab}`, `settings.tabs.${tab}`]),
  ) } },
});
let root: Root;
let view: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  view = document.createElement('div');
  root = createRoot(view);
});
afterEach(() => {
  act(() => { root.unmount(); });
  vi.unstubAllGlobals();
});

function context(activeTab: string): ComponentProps<typeof SettingsSidebar>['context'] {
  return {
    activeTab, isAdvancedOpen: false, isOpen: true, sidebarNavigation: null,
    setActiveTab: vi.fn(), setAddAccountType: vi.fn(), setIsAdvancedOpen: vi.fn(),
    t: translations.t,
  };
}

it('keeps Plugins visible and removes duplicate plugin entries from Settings', () => {
  const state = context('general');
  act(() => { root.render(<SettingsSidebar context={state} />); });
  const labels = [...view.querySelectorAll('.settings-sidebar__item')].map(node => node.textContent);
  expect(labels).toContain('settings.tabs.plugins');
  expect(labels).toContain('settings.tabs.graph');
  for (const tab of ['references', 'calendar', 'contacts', 'mail_accounts', 'reader', 'social', 'notion', 'ai', 'translate']) {
    expect(labels).not.toContain(`settings.tabs.${tab}`);
  }
  const plugins = [...view.querySelectorAll('button')].find(node => node.textContent === 'settings.tabs.plugins');
  act(() => { plugins?.click(); });
  expect(state.setActiveTab).toHaveBeenCalledWith('plugins');
});

it.each(['ai', 'mail', 'reader', 'references'])('keeps plugin settings reachable and selected for %s', activeTab => {
  act(() => { root.render(<SettingsSidebar context={context(activeTab)} />); });
  expect(view.querySelector('.settings-sidebar__item.active')?.textContent).toBe('settings.tabs.plugins');
  expect(pluginForSettingsTab(activeTab)).not.toBeNull();
  expect(pluginForSettingsTab('references')).toBe('resources');
  expect(pluginForSettingsTab('graph')).toBeNull();
});
