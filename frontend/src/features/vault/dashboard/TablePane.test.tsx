import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultViewBodyProps } from '../views/VaultViewBody';
import { fetchBrainTableStatus } from '../../../shared/api/brain';
import { fetchReferenceTable } from '../../../shared/api/literature-resources';
import { renderController } from './__tests__/controller-support';
import { installApiDefaults, PAGE_ID } from './test-support';
import { TablePane } from './TablePane';
import type { Page } from './types';

const probe = vi.hoisted(() => vi.fn<(props: VaultViewBodyProps) => void>());
vi.mock('../views/VaultViewBody', () => ({
  VaultViewBody: (props: VaultViewBodyProps) => { probe(props); return <div>Real dashboard boundary</div>; },
}));
vi.mock('../views/VaultViewsHeader', () => ({ VaultViewsHeader: () => null }));
vi.mock('../views/VaultGraph', () => ({ VaultGraph: () => null }));
vi.mock('../../../shared/api/vaults');
vi.mock('../../../shared/api/vault-views');
vi.mock('../../../shared/api/brain');
vi.mock('../../../shared/api/literature-resources');
vi.mock('../../../shared/api/resource-processing');

let harness: Awaited<ReturnType<typeof renderController>> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  installApiDefaults();
  vi.mocked(fetchBrainTableStatus).mockRejectedValue(new Error('disabled fixture'));
  vi.mocked(fetchReferenceTable).mockRejectedValue(new Error('disabled fixture'));
});
afterEach(async () => { await harness?.unmount(); });

describe('dashboard to view data preservation', () => {
  it.each(['inline', 'tab', 'split'] as const)('preserves original rows and opaque metadata in %s mode', async mode => {
    harness = await renderController('table/table/view/main', controller => (
      <TablePane dashboard={controller} tableId="table" mode={mode} />
    ));
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const attachment = new Blob(['fixture']);
    const handler = () => 'extension';
    const metadata = { table_id: 'table', attachment, cycle, handler, status: 'Open' };
    const page: Page = { id: PAGE_ID, title: 'Preserved', metadata, extension: new Map([['plugin', 1]]) };
    const pages = [page];
    await harness.run(controller => {
      controller.setPages(pages);
      controller.setTableNotes(pages);
      controller.setVisibleTableRecordsById({ table: pages });
    });
    const body = probe.mock.lastCall?.[0];
    expect(body?.notes).toHaveLength(1);
    expect(body?.notes?.[0]).toBe(page);
    expect(body?.allNotes).toBe(pages);
    expect(body?.notes?.[0]?.metadata).toBe(metadata);
    expect(body?.notes?.[0]?.metadata?.attachment).toBe(attachment);
    expect(body?.notes?.[0]?.metadata?.cycle).toBe(cycle);
    expect(body?.notes?.[0]?.metadata?.handler).toBe(handler);
    expect(body?.notes?.[0]?.extension).toBe(page.extension);
  });
});
