import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { useDashboardController, type DashboardController } from '../useDashboardController';
import { ACTIVE_VAULT_SLUG_KEY, storageSet } from '../../../shared/api/vault-context';
export async function renderController(path = '') {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: {}, initImmediate: false, showSupportNotice: false });
  storageSet(ACTIVE_VAULT_SLUG_KEY, 'dashboard-test');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let current: DashboardController | undefined;
  function ControllerHarness() {
    const result = useDashboardController();
    useLayoutEffect(() => { current = result; });
    return <div data-testid="mode">{result.viewMode}</div>;
  }
  await act(async () => {
    root.render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[`/@dashboard-test/knowledge/${path}`]}>
      <Routes><Route
        path="/@dashboard-test/knowledge/*"
        element={<ControllerHarness />}
      /></Routes>
    </MemoryRouter></I18nextProvider>);
    await Promise.resolve();
  });
  return {
    container,
    get current() {
      if (!current)
        throw new Error('Dashboard controller was not mounted');
      return current;
    },
    async run(callback: (value: DashboardController) => unknown) {
      await act(async () => { await callback(this.current); await Promise.resolve(); });
    },
    async unmount() { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); },
  };
}
