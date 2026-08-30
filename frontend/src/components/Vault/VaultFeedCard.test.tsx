import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { VaultFeedCard } from './VaultFeedCard';
import type { VaultFeedCardProps } from './vaultFeedTypes';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: string | Readonly<Record<string, unknown>>) => {
      if (typeof options === 'string') return options;
      const fallback = options?.defaultValue;
      return typeof fallback === 'string' ? fallback : key;
    },
  }),
}));

vi.mock('../../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('./VaultMarkdown', () => ({
  VaultMarkdown: ({ md }: { readonly md: string }) => <p>{md}</p>,
}));


interface MountedRoot {
  readonly container: HTMLDivElement;
  readonly root: Root;
}


const mountedRoots: MountedRoot[] = [];
const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};


beforeAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) throw new Error('Mounted feed card root is missing.');
    act(() => { mounted.root.unmount(); });
    mounted.container.remove();
  }
});


function renderCard(overrides: Partial<VaultFeedCardProps> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ container, root });
  const props: VaultFeedCardProps = {
    density: 'comfortable',
    excerptLines: 6,
    isRead: false,
    isSelected: false,
    note: {
      id: 'page-1',
      last_modified: '2026-08-30T10:00:00',
      metadata: {},
      title: 'Project Alpha',
    },
    onOpen: vi.fn(),
    onPreview: vi.fn(),
    onToggleSelect: vi.fn(),
    pillLimit: 5,
    pills: [],
    searchTerm: 'alpha',
    selectionActive: false,
    titlePreviewProps: { onMouseEnter: vi.fn(), onMouseLeave: vi.fn() },
    ...overrides,
  };
  act(() => { root.render(<VaultFeedCard {...props} />); });
  return { container, props };
}


describe('VaultFeedCard', () => {
  it('highlights search terms and opens the record only from the title', () => {
    const onOpen = vi.fn();
    const { container } = renderCard({ onOpen });
    expect(container.querySelector('mark')?.textContent).toBe('Alpha');
    const title = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open page: Project Alpha"]',
    );
    if (!title) throw new Error('Feed title button is missing.');
    act(() => { title.click(); });
    expect(onOpen).toHaveBeenCalledWith('page-1');
  });

  it('opens the reading pane and toggles selection through dedicated controls', () => {
    const onPreview = vi.fn();
    const onToggleSelect = vi.fn();
    const { container } = renderCard({ onPreview, onToggleSelect });
    const preview = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open reading pane"]',
    );
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!preview || !checkbox) throw new Error('Feed card controls are missing.');
    act(() => {
      preview.click();
      checkbox.click();
    });
    expect(onPreview).toHaveBeenCalledWith('page-1');
    expect(onToggleSelect).toHaveBeenCalledWith('page-1', false);
  });
});
