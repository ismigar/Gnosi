import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ca from '../../i18n/locales/ca/translation.json';
import es from '../../i18n/locales/es/translation.json';
import en from '../../i18n/locales/en/translation.json';
import fr from '../../i18n/locales/fr/translation.json';
import { ProfileSettingsNavigation } from './ProfileSettingsNavigation';
import { PrincipalAgentReference } from './PrincipalAgentReference';

vi.mock('../../api/configuration', () => ({ fetchConfiguration: () => Promise.resolve({ ai: { active_agent_id: 'personal', agents: [{ id: 'personal', name: 'My Brain' }, { id: 'builtin.feeds-reader.default', managed_by: 'builtin:feeds-reader', name: 'Feeds and podcasts' }] } }) }));
vi.mock('../../hooks/useActiveVaultId', () => ({ useActiveVaultId: () => 'test-vault' }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); vi.unstubAllGlobals(); });

describe('principal reference', () => {
    it.each(['ca', 'es', 'en', 'fr'])('shows the plugin profile in %s without a duplicate model selector', async language => {
        const openSettings = vi.fn();
        const i18n = createInstance();
        await i18n.init({ lng: language, fallbackLng: false, resources: { ca: { translation: ca }, es: { translation: es }, en: { translation: en }, fr: { translation: fr } } });
        await act(async () => { root.render(<I18nextProvider i18n={i18n}><MemoryRouter><ProfileSettingsNavigation.Provider value={openSettings}><PrincipalAgentReference operation="podcast" /></ProfileSettingsNavigation.Provider></MemoryRouter></I18nextProvider>); await Promise.resolve(); });
        expect(container.textContent).toContain(i18n.t('settings.ai.assistant.builtin_profiles.feeds-reader'));
        expect(container.querySelectorAll('p')).toHaveLength(1);
        expect(container.textContent).not.toContain('agent_execution.');
        expect(container.querySelector('select')).toBeNull();
        expect(container.querySelector('button')?.textContent).toBe(i18n.t('agent_execution.configure'));
        act(() => { container.querySelector('button')?.click(); });
        expect(openSettings).toHaveBeenCalledWith('agents', 'builtin.feeds-reader.default');
    });
});
