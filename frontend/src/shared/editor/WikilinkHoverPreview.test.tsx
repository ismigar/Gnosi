import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { fetchVaultPagePreview } from '../api/vaults';
import { WikilinkHoverPreview } from './WikilinkHoverPreview';
import { invalidatePreviewCache } from './wikilinkPreviewCache';


vi.mock('../api/vaults', () => ({
  fetchVaultPagePreview: vi.fn(),
}));


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('./VaultMarkdown', () => ({
  VaultMarkdown: ({ md }: { md: string }) => (
    <div data-testid="rendered-preview-markdown">{md}</div>
  ),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];


beforeAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
  vi.clearAllMocks();
  invalidatePreviewCache();
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) continue;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});


function render(element: ReactElement): void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ container, root });
  act(() => {
    root.render(element);
  });
}


describe('WikilinkHoverPreview', () => {
  it('requests and renders the full record body instead of its excerpt', async () => {
    vi.mocked(fetchVaultPagePreview).mockResolvedValueOnce({
      body_md: 'Complete body\n\nwith additional sections',
      excerpt: 'Short excerpt',
      id: 'target/page',
      title: 'Target record',
    });

    render(
      <WikilinkHoverPreview
        pageId="target/page"
        anchorRect={{ bottom: 40, left: 30, top: 20 }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchVaultPagePreview).toHaveBeenCalledWith(
      'target/page',
      { full: true },
      expect.any(AbortSignal),
    );
    const markdown = document.body.querySelector(
      '[data-testid="rendered-preview-markdown"]',
    );
    expect(markdown?.textContent).toBe(
      'Complete body\n\nwith additional sections',
    );
    expect(document.body.textContent).not.toContain('Short excerpt');
  });
});
