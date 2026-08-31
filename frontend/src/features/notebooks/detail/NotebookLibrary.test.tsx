import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import NotebookLibrary from './NotebookLibrary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('../../../shared/ui/layout/AppHeader', () => ({ AppHeader: () => null }));
vi.mock('../../../shared/hooks/useKeyboardScroll', () => ({ useKeyboardScroll: () => undefined }));
vi.mock('../../../shared/api/useNotebookData', () => ({
  useNotebookLibrary: () => ({
    data: {
      items: [{
        id: 'fixture-notebook', title: 'Recerca sintètica', status: 'available',
        visibility: 'private', conversation_mode: 'private_member',
        resource_count: 2, source_counts: { available: 2 },
      }],
      total: 1, page: 1, page_size: 24,
    },
    isFetching: false, error: null,
  }),
}));

afterEach(() => { vi.unstubAllGlobals(); });

it('names the interactive notebook card with its visible title', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<MemoryRouter><NotebookLibrary onCreate={() => undefined} /></MemoryRouter>);
      await Promise.resolve();
    });
    const card = container.querySelector('button.notebook-card');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('aria-label')).toBe('Recerca sintètica');
    expect(card?.querySelector('h2')?.textContent).toBe('Recerca sintètica');
  } finally {
    act(() => { root.unmount(); });
  }
});
