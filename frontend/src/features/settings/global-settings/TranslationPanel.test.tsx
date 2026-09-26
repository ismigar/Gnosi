import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ca from '../../../shared/i18n/locales/ca/translation.json';
import en from '../../../shared/i18n/locales/en/translation.json';
import es from '../../../shared/i18n/locales/es/translation.json';
import fr from '../../../shared/i18n/locales/fr/translation.json';
import { ProfileSettingsNavigation } from '../../../shared/ui/settings/ProfileSettingsNavigation';
import { TranslationPanel } from './TranslationPanel';

vi.mock('../../../shared/api/configuration', () => ({ fetchConfiguration: () => Promise.resolve({
  ai: { active_agent_id: 'personal', agents: [
    { id: 'personal', name: 'Personal assistant' },
    { id: 'builtin.translation.default', name: 'Translation', managed_by: 'builtin:translation' },
  ] },
}) }));
vi.mock('../../../shared/hooks/useActiveVaultId', () => ({ useActiveVaultId: () => 'test-vault' }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); await Promise.resolve(); });
  container.remove();
  vi.unstubAllGlobals();
});

it.each(['ca', 'en', 'es', 'fr'])('opens the translation profile and explains the active workflow in %s', async language => {
  const i18n = createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: {
    ca: { translation: ca }, en: { translation: en }, es: { translation: es }, fr: { translation: fr },
  } });
  const navigate = vi.fn();
  await act(async () => {
    root.render(<I18nextProvider i18n={i18n}>
      <ProfileSettingsNavigation.Provider value={navigate}>
        <TranslationPanel context={{ t: i18n.t }} />
      </ProfileSettingsNavigation.Provider>
    </I18nextProvider>);
    await Promise.resolve();
  });
  expect(container.textContent).toContain(i18n.t('translate_settings.intro'));
  expect(container.textContent).toContain(i18n.t('translate_settings.legacy_notice'));
  expect(container.textContent).not.toContain('translate_settings.');
  expect(container.textContent).not.toContain('Personal assistant');
  expect(container.querySelector('input')).toBeNull();
  const configure = container.querySelector<HTMLButtonElement>('button');
  expect(configure?.disabled).toBe(false);
  act(() => { configure?.click(); });
  expect(navigate).toHaveBeenCalledWith('agents', 'builtin.translation.default');
});
