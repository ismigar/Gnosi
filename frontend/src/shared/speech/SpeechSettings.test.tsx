import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpeechSettings } from './SpeechSettings';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), preview: vi.fn(), stop: vi.fn() }));
vi.mock('../api/speech-output', () => ({ fetchSpeechSettings: mocks.fetch, saveSpeechSettings: mocks.save }));
vi.mock('../hooks/useActiveVaultId', () => ({ useActiveVaultId: () => 'vault' }));
vi.mock('./useSpeechOutput', () => ({ useSpeechOutput: () => ({ state: 'idle', activity: 'idle', error: false, preview: mocks.preview, stop: mocks.stop }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ca' } }) }));
const configuration = { settings: { provider: 'local', voice: 'auto', language: 'auto', speed: 1 }, revision: 'one', local_available: true, local_voices: [], openai_configured: false };
let root: Root; let host: HTMLDivElement; let client: QueryClient;
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render(editable = true) {
  await act(async () => { root.render(<QueryClientProvider client={client}><SpeechSettings editable={editable} /></QueryClientProvider>); });
  await settle(); await settle();
}
function button(key: string) {
  const found = [...host.querySelectorAll('button')].find(item => item.textContent === key);
  if (!found) throw new Error(`Missing button: ${key}`);
  return found;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.fetch.mockResolvedValue(configuration);
  mocks.save.mockImplementation(async settings => ({ ...configuration, settings, revision: 'two', openai_configured: true }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); client.clear(); vi.unstubAllGlobals(); });
it('requires an explicit saved global change before neural preview', async () => {
  await render(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  const select = host.querySelector('select');
  if (!select) throw new Error('Missing provider');
  await act(async () => { select.value = 'openai'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('speech.external_notice'); expect(host.textContent).toContain('speech.openai_missing');
  expect(button('speech.preview').disabled).toBe(true);
  await act(async () => { button('speech.save').click(); }); await settle();
  expect(mocks.save).toHaveBeenCalledWith({ provider: 'openai', voice: 'auto', language: 'auto', speed: 1 });
  expect(client.getQueryData(['speech-settings', 'vault'])).toEqual(expect.objectContaining({ revision: 'two' }));
  expect(button('speech.preview').disabled).toBe(false);
});
it('shows shared settings without editable controls outside the central admin section', async () => {
  await render(false);
  expect(host.querySelector('select')).toBeNull(); expect(host.textContent).toContain('speech.configure');
  expect(host.textContent).toContain('speech.shared'); expect(mocks.save).not.toHaveBeenCalled();
});
