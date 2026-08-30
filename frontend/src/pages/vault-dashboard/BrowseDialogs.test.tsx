import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlobalSearchModalProps } from '../../components/Vault/GlobalSearchModal';
import { fetchBrainTableStatus } from '../../shared/api/brain';
import { fetchReferenceTable } from '../../shared/api/literature-resources';
import { renderController } from './__tests__/controller-support';
import { installApiDefaults, PAGE_ID } from './test-support';
import { BrowseDialogs } from './BrowseDialogs';
import type { Page } from './types';

const probe = vi.hoisted(() => vi.fn<(props: GlobalSearchModalProps) => void>());
vi.mock('../../components/Vault/GlobalSearchModal', () => ({
  GlobalSearchModal: (props: GlobalSearchModalProps) => { probe(props); return null; },
}));
vi.mock('../../components/Vault/TagsModal', () => ({ default: () => null }));
vi.mock('../../components/Vault/PresentationMode', () => ({ default: () => null }));
vi.mock('../../components/Vault/InlineComments', () => ({ default: () => null }));
vi.mock('../../components/Vault/WorkspacesModal', () => ({ default: () => null }));
vi.mock('../../components/Vault/MetadataLookupModal', () => ({ MetadataLookupModal: () => null }));
vi.mock('../../components/Vault/RecentModal', () => ({ RecentModal: () => null }));
vi.mock('../../components/Vault/TranslateLanguagesModal', () => ({ TranslateLanguagesModal: () => null }));
vi.mock('../../components/Vault/ProcessResourceModal', () => ({ ProcessResourceModal: () => null }));
vi.mock('../../shared/api/vaults');
vi.mock('../../shared/api/vault-views');
vi.mock('../../shared/api/brain');
vi.mock('../../shared/api/literature-resources');
vi.mock('../../shared/api/resource-processing');

let harness: Awaited<ReturnType<typeof renderController>> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  installApiDefaults();
  vi.mocked(fetchBrainTableStatus).mockRejectedValue(new Error('disabled fixture'));
  vi.mocked(fetchReferenceTable).mockRejectedValue(new Error('disabled fixture'));
});
afterEach(async () => { await harness?.unmount(); harness = undefined; });

describe('dashboard to global search data preservation', () => {
  it.each([false, true])('preserves opaque rows without traversal with dialog open=%s', async isOpen => {
    harness = await renderController('', controller => <BrowseDialogs {...controller} />);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const arrayCycle: unknown[] = [];
    arrayCycle.push(arrayCycle);
    const attachment = new Blob(['synthetic attachment']);
    const handler = () => 'plugin value';
    const marker = Symbol('plugin marker');
    const readOpaque = vi.fn(() => { throw new Error('opaque extension must not be inspected'); });
    const extension = Object.defineProperty({}, 'hiddenValue', { enumerable: true, get: readOpaque });
    const metadata = { table_id: 'table', tags: ['searchable'], cycle, arrayCycle, attachment, handler, marker, extension };
    const page: Page = { id: PAGE_ID, title: 'Mercè', metadata, plugin: extension };
    const pages = [page, { id: 'absent', title: 'Without metadata' }];
    await harness.run(controller => {
      controller.setPages(pages);
      controller.setIsGlobalSearchOpen(isOpen);
    });

    const props = probe.mock.lastCall?.[0];
    expect(props?.isOpen).toBe(isOpen);
    expect(props?.allNotes).toBe(pages);
    expect(props?.allNotes?.[0]).toBe(page);
    expect(props?.allNotes?.[0]?.metadata).toBe(metadata);
    expect(props?.allNotes?.[0]?.metadata?.cycle).toBe(cycle);
    expect(props?.allNotes?.[0]?.metadata?.arrayCycle).toBe(arrayCycle);
    expect(props?.allNotes?.[0]?.metadata?.attachment).toBe(attachment);
    expect(props?.allNotes?.[0]?.metadata?.handler).toBe(handler);
    expect(props?.allNotes?.[0]?.metadata?.marker).toBe(marker);
    expect(props?.allNotes?.[0]?.plugin).toBe(extension);
    expect(props?.allNotes?.[1]?.metadata).toBeUndefined();
    expect(readOpaque).not.toHaveBeenCalled();
    expect(props?.onNoteSelect).toBe(harness.current.loadPage);
    expect(props?.tables).toBe(harness.current.registry.tables);
    expect(props?.globalIndex).toBe(harness.current.globalIndex);
    expect(props?.aliasesById).toBe(harness.current.aliasIndex);

    await harness.run(() => { props?.onClose(); });
    expect(harness.current.isGlobalSearchOpen).toBe(false);
    expect(probe.mock.lastCall?.[0]?.allNotes).toBe(pages);
    expect(readOpaque).not.toHaveBeenCalled();
  });
});
