import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  useVaultViewData,
  type VaultViewConfig,
  type VaultViewPage,
} from './useVaultViewData';


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
