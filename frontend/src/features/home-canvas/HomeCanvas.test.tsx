import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomeCanvas from './HomeCanvas';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  i18n: { language: 'en' },
}) }));
vi.mock('../../shared/hooks/useActiveVaultName', () => ({ useActiveVaultName: () => 'Research' }));
vi.mock('../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: (id: string) => id === 'contacts' }) }));
vi.mock('./apps/OptionalBlock', () => ({ default: () => <p>Saved contacts</p> }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

describe('home editing', () => {
  it('offers only available apps and keeps hidden blocks when saving an edited layout', async () => {
    const hidden = { id: 'saved-mail', kind: 'mail', width: 2 as const, height: 1 as const, settings: {} };
    const preferences = { start_mode: 'canvas' as const, revision: null, blocks: [hidden] };
    const save = vi.fn(() => Promise.resolve(preferences));
    act(() => {
      root.render(
        <MemoryRouter>
          <HomeCanvas preferences={preferences} onSave={save} onReload={() => Promise.resolve(preferences)} />
        </MemoryRouter>,
      );
    });
    expect(container.textContent).toContain('Research');
    const click = async (selector: string) => {
      const button = container.querySelector<HTMLButtonElement>(selector);
      expect(button).toBeTruthy();
      await act(async () => { button?.click(); await Promise.resolve(); });
    };
    await click('[data-testid="home-edit"]');
    await click('button[aria-controls="home-block-catalog"]');
    expect(container.querySelector('[data-add-kind="mail"]')).toBeNull();
    await click('[data-add-kind="contacts"]');
    const selects = container.querySelectorAll<HTMLSelectElement>('[data-home-block="contacts"] .home-block__tools select');
    const [size, height] = [selects[0], selects[1]];
    if (!size || !height) throw new Error('Missing block dimension controls');
    act(() => {
      size.value = '3'; size.dispatchEvent(new Event('change', { bubbles: true }));
      height.value = '2'; height.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click('[data-testid="home-edit"]');
    expect(save).toHaveBeenCalledWith({ ...preferences, blocks: [hidden, expect.objectContaining({ kind: 'contacts', width: 3, height: 2 })] });
  });
});
