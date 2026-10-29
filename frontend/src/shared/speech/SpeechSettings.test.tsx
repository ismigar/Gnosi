import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpeechSettings } from './SpeechSettings';
import type { SpeechConfiguration, SpeechSettings as SavedSpeechSettings } from '../api/speech-output';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), preview: vi.fn(), stop: vi.fn(), vault: 'vault' }));
vi.mock('../api/speech-output', () => ({ fetchSpeechSettings: mocks.fetch, saveSpeechSettings: mocks.save }));
vi.mock('../hooks/useActiveVaultId', () => ({ useActiveVaultId: () => mocks.vault }));
vi.mock('../api/vault-context', () => ({ getActiveVaultId: () => mocks.vault }));
vi.mock('./useSpeechOutput', () => ({ useSpeechOutput: () => ({ state: 'idle', activity: 'idle', error: false, preview: mocks.preview, stop: mocks.stop }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ca' } }) }));
const configuration: SpeechConfiguration = { settings: { provider: 'local', voice: 'auto', language: 'auto', speed: 1 }, revision: 'one', local_available: true, local_voices: [], openai_configured: false };
let root: Root; let host: HTMLDivElement; let client: QueryClient;
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }
async function autosave() { await act(async () => { await vi.advanceTimersByTimeAsync(600); }); await settle(); }
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
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.vault = 'vault'; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.fetch.mockResolvedValue(configuration);
  mocks.save.mockImplementation((settings: SavedSpeechSettings) => Promise.resolve({ ...configuration, settings, revision: 'two', openai_configured: true }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('autosaves a global change before enabling neural preview', async () => {
  await render(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  const select = host.querySelector('select');
  if (!select) throw new Error('Missing provider');
  act(() => { select.value = 'openai'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('speech.external_notice'); expect(host.textContent).toContain('speech.openai_missing');
  expect(button('speech.preview').disabled).toBe(true);
  expect(host.textContent).not.toContain('speech.save'); await autosave();
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
  expect(host.textContent).toContain('skill_autosave.pending');
  client.setQueryData(['speech-settings', 'next'], configuration);
  mocks.vault = 'next';
  await render();
  expect(host.querySelector('select')?.value).toBe('local');
  expect(host.textContent).not.toContain('speech.save');
  await autosave(); expect(mocks.save).not.toHaveBeenCalled();
});
it('updates a saved voice when automatic and explicit choices share an effective revision', async () => {
  const neural: SpeechConfiguration = { ...configuration, settings: { ...configuration.settings, provider: 'openai' }, openai_configured: true };
  mocks.fetch.mockResolvedValue(neural);
  await render();
  client.setQueryData(['speech-settings', 'vault'], { ...neural, settings: { ...neural.settings, voice: 'marin' } });
  await settle();
  expect(host.querySelectorAll('select')[1]?.value).toBe('marin');
  expect(host.textContent).not.toContain('speech.save');
  expect(mocks.save).not.toHaveBeenCalled();
});

it('coalesces quick language and speed edits into one autosave', async () => {
  await render();
  const selects = host.querySelectorAll('select');
  const language = selects[2]; const speed = selects[3];
  if (!language || !speed) throw new Error('Missing language or speed');
  act(() => { language.value = 'ca'; language.dispatchEvent(new Event('change', { bubbles: true })); });
  act(() => { speed.value = '1.15'; speed.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(mocks.save).not.toHaveBeenCalled(); await autosave();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledWith({ provider: 'local', voice: 'auto', language: 'ca', speed: 1.15 });
});
it('retains failed edits, disables preview and retries through the existing retry action', async () => {
  mocks.save.mockRejectedValueOnce(new Error('offline')); await render();
  const select = host.querySelectorAll('select')[3];
  if (!select) throw new Error('Missing speed');
  act(() => { select.value = '1.15'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await autosave(); expect(host.textContent).toContain('speech.settings_failed');
  expect(select.value).toBe('1.15'); expect(button('speech.preview').disabled).toBe(true);
  act(() => { button('common.retry').click(); }); await settle();
  expect(mocks.save).toHaveBeenCalledTimes(2); expect(host.textContent).not.toContain('speech.settings_failed');
  expect(button('speech.preview').disabled).toBe(false);
});
it('flushes a pending change when the settings panel closes', async () => {
  await render(); const select = host.querySelectorAll('select')[3];
  if (!select) throw new Error('Missing speed');
  act(() => { select.value = '0.85'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { root.render(<div />); await Promise.resolve(); });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledWith({ provider: 'local', voice: 'auto', language: 'auto', speed: 0.85 });
});
