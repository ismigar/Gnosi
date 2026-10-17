import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpeechSettings } from './SpeechSettings';
import type { SpeechConfiguration, SpeechSettings as SavedSpeechSettings } from '../api/speech-output';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), preview: vi.fn(), stop: vi.fn(), vault: 'vault' }));
vi.mock('../api/speech-output', () => ({ fetchSpeechSettings: mocks.fetch, saveSpeechSettings: mocks.save }));
vi.mock('../hooks/useActiveVaultId', () => ({ useActiveVaultId: () => mocks.vault }));
vi.mock('./useSpeechOutput', () => ({ useSpeechOutput: () => ({ state: 'idle', activity: 'idle', error: false, preview: mocks.preview, stop: mocks.stop }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ca' } }) }));
const configuration: SpeechConfiguration = { settings: { provider: 'local', voice: 'auto', language: 'auto', speed: 1 }, revision: 'one', local_available: true, local_voices: [], openai_configured: false };
let root: Root; let host: HTMLDivElement; let client: QueryClient;
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render(editable = true) {
  act(() => { root.render(<QueryClientProvider client={client}><SpeechSettings editable={editable} /></QueryClientProvider>); });
  await settle(); await settle();
}
function button(key: string) {
  const found = [...host.querySelectorAll('button')].find(item => item.textContent === key);
  if (!found) throw new Error(`Missing button: ${key}`);
  return found;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.vault = 'vault'; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.fetch.mockResolvedValue(configuration);
  mocks.save.mockImplementation((settings: SavedSpeechSettings) => Promise.resolve({ ...configuration, settings, revision: 'two', openai_configured: true }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(() => { act(() => { root.unmount(); }); client.clear(); vi.unstubAllGlobals(); });
it('requires an explicit saved global change before neural preview', async () => {
  await render(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  const select = host.querySelector('select');
  if (!select) throw new Error('Missing provider');
  act(() => { select.value = 'openai'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('speech.external_notice'); expect(host.textContent).toContain('speech.openai_missing');
  expect(button('speech.preview').disabled).toBe(true);
  act(() => { button('speech.save').click(); }); await settle();
  expect(mocks.save).toHaveBeenCalledWith({ provider: 'openai', voice: 'auto', language: 'auto', speed: 1 });
  expect(client.getQueryData(['speech-settings', 'vault'])).toEqual(expect.objectContaining({ revision: 'two' }));
  expect(button('speech.preview').disabled).toBe(false);
});
it('shows shared settings without editable controls outside the central admin section', async () => {
  await render(false);
  expect(host.querySelector('select')).toBeNull(); expect(host.textContent).toContain('speech.configure');
  expect(host.textContent).toContain('speech.shared'); expect(mocks.save).not.toHaveBeenCalled();
});
it('discards unsaved voice changes when switching Vaults with the same saved revision', async () => {
  await render();
  const select = host.querySelector('select');
  if (!select) throw new Error('Missing provider');
  act(() => { select.value = 'openai'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(button('speech.save').disabled).toBe(false);
  client.setQueryData(['speech-settings', 'next'], configuration);
  mocks.vault = 'next';
  await render();
  expect(host.querySelector('select')?.value).toBe('local');
  expect(button('speech.save').disabled).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('updates a saved voice when automatic and explicit choices share an effective revision', async () => {
  const neural: SpeechConfiguration = { ...configuration, settings: { ...configuration.settings, provider: 'openai' }, openai_configured: true };
  mocks.fetch.mockResolvedValue(neural);
  await render();
  client.setQueryData(['speech-settings', 'vault'], { ...neural, settings: { ...neural.settings, voice: 'marin' } });
  await settle();
  expect(host.querySelectorAll('select')[1]?.value).toBe('marin');
  expect(button('speech.save').disabled).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
});
