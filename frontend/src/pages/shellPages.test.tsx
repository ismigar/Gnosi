import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Layout } from '../components/Layout';
import HomePage from './HomePage';


const mocks = vi.hoisted(() => ({
  emitAppEvent: vi.fn(),
  isEnabled: vi.fn((pluginId: string) => pluginId === 'contacts'),
}));


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('../hooks/useActiveVaultName', () => ({
  useActiveVaultName: () => 'Research',
}));


vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
}));


vi.mock('../plugins/usePlugins', () => ({
  usePlugins: () => ({ isEnabled: mocks.isEnabled }),
}));


vi.mock('../shared/platform/app-events', () => ({
  emitAppEvent: mocks.emitAppEvent,
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});


describe('shell pages', () => {
  it('renders the graph shell, toggles panels, and preserves focus shortcuts', () => {
    act(() => {
      root.render(
        <Layout
          bottomPanel={<p>Connections</p>}
          controls={<button type="button">Zoom</button>}
          sidebar={<p>Filters</p>}
        >
          <p>Graph</p>
        </Layout>,
      );
    });

    const app = container.querySelector('#app');
    const panelToggle = container.querySelector('#btn-toggle-panel');
    if (!(app instanceof HTMLDivElement)
      || !(panelToggle instanceof HTMLButtonElement)) {
      throw new Error('Graph layout controls were not rendered');
    }
    expect(app.classList.contains('panel-hidden')).toBe(false);
    act(() => {
      panelToggle.click();
    });
    expect(app.classList.contains('panel-hidden')).toBe(true);

    const sidebar = container.querySelector('#side-panel');
    if (!(sidebar instanceof HTMLElement)) {
      throw new Error('Graph sidebar was not rendered');
    }
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        ctrlKey: true,
        key: 'p',
        shiftKey: true,
      }));
    });
    expect(document.activeElement).toBe(sidebar);

    const connectionsToggle = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Show Connections'));
    if (!connectionsToggle) {
      throw new Error('Connections panel toggle was not rendered');
    }
    act(() => {
      connectionsToggle.click();
    });
    expect(container.textContent).toContain('Connections');
  });

  it('filters plugin modules and opens settings through the typed event bus', () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('Research');
    expect(container.textContent).toContain('Contacts');
    expect(container.textContent).not.toContain('Mail (Inbox)');
    const settings = container.querySelector('[data-testid="home-settings-card"]');
    if (!(settings instanceof HTMLButtonElement)) {
      throw new Error('Settings card was not rendered');
    }
    act(() => {
      settings.click();
    });
    expect(mocks.emitAppEvent).toHaveBeenCalledWith('open-settings', null);
  });
});
