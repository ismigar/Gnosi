import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Layout } from '../shared/ui/layout/Layout';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en' },
  }),
}));


vi.mock('../shared/hooks/useActiveVaultName', () => ({
  useActiveVaultName: () => 'Research',
}));


vi.mock('../shared/hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
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

});
