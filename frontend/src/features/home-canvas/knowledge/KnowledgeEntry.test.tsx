import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { requestAt, resetApiTestStorage } from '../../../../tests/api-request';
import { activateVault } from '../../../shared/routing/vaultRouting';
import KnowledgeBlocks from './KnowledgeBlocks';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en' } }) }));
afterEach(() => { vi.restoreAllMocks(); resetApiTestStorage(); vi.useRealTimers(); });

async function settle() {
  for (let n = 0; n < 5; n++) await act(async () => { await vi.advanceTimersByTimeAsync(1); });
}

it.each(['graph', 'board'] as const)('starts a cold %s with only the cache request and retries without reporting an empty Vault', async kind => {
  vi.useFakeTimers();
  activateVault({ id: 'cold', slug: 'cold', name: 'Cold' });
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ pages: [], complete: false }))
    .mockResolvedValueOnce(Response.json({ pages: [], complete: true }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = mountTestComponent(<QueryClientProvider client={client}><MemoryRouter>
    <KnowledgeBlocks block={{ id: 'block', kind, width: 1, height: 1, settings: {} }} editing={false} onConfigure={vi.fn()} />
  </MemoryRouter></QueryClientProvider>);
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  const first = requestAt(fetch.mock.calls, 0);
  expect(new URL(first.url).pathname).toBe('/api/vault/home-knowledge-catalog');
  expect(first.headers.get('X-Vault-ID')).toBe('cold');
  const empty = kind === 'graph' ? 'home_canvas.knowledge.noNotes' : 'home_canvas.knowledge.noBoards';
  expect(view.container.textContent).toContain('home_canvas.knowledge.catalogPending');
  expect(view.container.textContent).not.toContain(empty);
  expect(view.container.querySelector('a')?.getAttribute('href')).toBe('/@cold/knowledge');
  const refresh = view.container.querySelector('button');
  if (!refresh) throw new Error('Missing catalog retry');
  act(() => { refresh.click(); });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(new URL(requestAt(fetch.mock.calls, 1).url).pathname).toBe('/api/vault/home-knowledge-catalog');
  expect(view.container.textContent).toContain(empty);
  view.unmount();
  client.clear();
});
