import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { siteStatistics, type SiteConfig } from '../../shared/api/sites';
import { StatisticsPanel } from './StatisticsPanel';
vi.mock('../../shared/api/sites', () => ({ siteStatistics: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ca' } }) }));
const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
const site = { id: 'first', name: 'First', origin: 'https://example.org', revision: 1 } as SiteConfig;
const month = { month: '2026-11', visits: 2795, pages: 5317, hits: 17248, clients: 3106, files: 12390, transfer_bytes: 617181348 };
const data = { source_url: 'https://example.org/webalizer/', generated_at: '09-nov-2026', fetched_at: '2026-11-09T12:00:00Z', months: [month] };
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
afterEach(() => { vi.clearAllMocks(); });
it('shows source counters, history and refreshes through the scoped API', async () => {
  vi.mocked(siteStatistics).mockResolvedValue(data);
  const view = mountTestComponent(<StatisticsPanel site={site} context={context} onChange={vi.fn()} />);
  await flush();
  expect(siteStatistics).toHaveBeenCalledWith('first', context, expect.any(AbortSignal));
  expect(view.container.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(view.container.textContent).toContain('2.795');
  expect(view.container.querySelector('a')?.href).toBe(data.source_url);
  act(() => { view.container.querySelector<HTMLButtonElement>('.gnosi-refresh-button')?.click(); });
  await flush();
  expect(siteStatistics).toHaveBeenCalledTimes(2);
  view.unmount();
});
it('aborts obsolete requests on site change and does not show previous statistics', async () => {
  vi.mocked(siteStatistics).mockResolvedValueOnce(data).mockImplementationOnce(() => new Promise(() => {}));
  const view = mountTestComponent(<StatisticsPanel site={site} context={context} onChange={vi.fn()} />);
  await flush();
  const signal = vi.mocked(siteStatistics).mock.calls[0]?.[2];
  view.render(<StatisticsPanel site={{ ...site, id: 'second' }} context={context} onChange={vi.fn()} />);
  await flush();
  expect(signal?.aborted).toBe(true);
  expect(view.container.querySelector('tbody')).toBeNull();
  view.unmount();
});
it('shows a readable failure and keeps refresh available', async () => {
  vi.mocked(siteStatistics).mockRejectedValue(new Error('unavailable'));
  const view = mountTestComponent(<StatisticsPanel site={site} context={context} onChange={vi.fn()} />);
  await flush();
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('statistics.error');
  expect(view.container.querySelector<HTMLButtonElement>('.gnosi-refresh-button')?.disabled).toBe(false);
  view.unmount();
});

it('keeps statistics usable with an incomplete website origin', async () => {
  vi.mocked(siteStatistics).mockResolvedValue(data);
  const view = mountTestComponent(<StatisticsPanel site={{ ...site, origin: '', statistics_url: data.source_url }} context={context} onChange={vi.fn()} />);
  await flush();
  expect(view.container.querySelector('input')?.placeholder).toBe('/webalizer/');
  expect(view.container.querySelectorAll('tbody tr')).toHaveLength(1);
  view.unmount();
});
