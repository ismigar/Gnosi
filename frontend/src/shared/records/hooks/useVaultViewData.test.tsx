import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  useVaultViewData,
  type VaultViewConfig,
  type VaultViewPage,
  type VaultViewDataResult,
} from './useVaultViewData';
interface ConsumerRow extends VaultViewPage {
  readonly title: string;
  readonly metadata: {
    readonly extension: { readonly custom: Date; readonly nested: { readonly keep: boolean } };
    readonly rank: number;
  };
}


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
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});


function ViewResult({
  pages,
  view,
}: {
  readonly pages: readonly VaultViewPage[];
  readonly view: VaultViewConfig;
}) {
  const { sortedPages } = useVaultViewData({ pages, view });
  return (
    <ol>
      {sortedPages.map((page) => (
        <li key={page.id}>{String(page.title)}</li>
      ))}
    </ol>
  );
}


describe('useVaultViewData', () => {
  it('retains concrete consumer rows, nested metadata and memoized arrays across rerenders', () => {
    const plugin = { custom: new Date('2026-08-30T00:00:00Z'), nested: { keep: true } };
    const first: ConsumerRow = { id: 'first', title: 'First', metadata: { extension: plugin, rank: 2 } };
    const second: ConsumerRow = { id: 'second', title: 'Second', metadata: { extension: plugin, rank: 1 } };
    const pages = [first, second];
    const sort = [{ field: 'rank', direction: 'asc' }];
    const view = { sort };
    const snapshots: VaultViewDataResult<ConsumerRow>[] = [];
    const receive = (value: VaultViewDataResult<ConsumerRow>) => { snapshots.push(value); };
    function Probe({ tick }: { readonly tick: number }) {
      const result = useVaultViewData({ pages, view });
      useEffect(() => { receive(result); }, [result]);
      return <span>{tick}</span>;
    }
    act(() => { root.render(<Probe tick={0} />); });
    act(() => { root.render(<Probe tick={1} />); });
    expect(snapshots).toHaveLength(2);
    const before = snapshots[0];
    const after = snapshots[1];
    expect(before?.sortedPages).toEqual([second, first]);
    expect(after?.sortedPages).toBe(before?.sortedPages);
    expect(after?.filteredPages).toBe(before?.filteredPages);
    expect(after?.sortedPages[0]).toBe(second);
    expect(after?.sortedPages[1]?.metadata.extension).toBe(plugin);
    expect(pages).toEqual([first, second]);
  });

  it('filters metadata and sorts by a top-level date field', () => {
    const pages: VaultViewPage[] = [
      {
        id: 'older',
        last_modified: '2026-01-10',
        metadata: { status: 'open' },
        title: 'Older',
      },
      {
        id: 'closed',
        last_modified: '2026-08-20',
        metadata: { status: 'closed' },
        title: 'Closed',
      },
      {
        id: 'newer',
        last_modified: '2026-08-19',
        metadata: { status: 'open' },
        title: 'Newer',
      },
    ];
    const view: VaultViewConfig = {
      filters: [{ field: 'status', operator: 'equals', value: 'open' }],
      sort: { direction: 'desc', field: 'last_modified' },
    };

    act(() => {
      root.render(<ViewResult pages={pages} view={view} />);
    });

    expect([...container.querySelectorAll('li')].map((item) => item.textContent))
      .toEqual(['Newer', 'Older']);
  });
});
