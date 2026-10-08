import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { usePageReferenceTitle } from './usePageReferenceTitle';

const fetchPage = vi.hoisted(() => vi.fn());
const context = vi.hoisted(() => ({ workspaceId: 'personal', vaultId: 'first', userId: 'user', userEmail: '' }));
vi.mock('../api/vaults', () => ({ fetchVaultPage: fetchPage }));
vi.mock('../api/request-context', () => ({ currentRequestContext: () => context }));
const id = '9c05e9c1-dd54-470f-bac9-ff59cbd70bd4';
const index = {};
const container = document.createElement('div');
let root: ReturnType<typeof createRoot>;
function Label() { return <span>{usePageReferenceTitle(id, index, '', 'Unavailable page')}</span>; }
beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { act(() => { root.unmount(); }); fetchPage.mockReset(); context.vaultId = 'first'; });

it('loads a missing title without exposing its ID while loading', async () => {
    let complete: ((page: unknown) => void) | undefined;
    fetchPage.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    root = createRoot(container);
    act(() => { root.render(<Label />); });
    expect(container.textContent).toBe('Unavailable page');
    expect(fetchPage).toHaveBeenCalledWith(id, expect.any(AbortSignal));
    await act(async () => { complete?.({ title: 'A book', metadata: {} }); await Promise.resolve(); });
    expect(container.textContent).toBe('A book');
});

it('does not reuse a loaded title after switching vaults', async () => {
    fetchPage.mockResolvedValueOnce({ title: 'First vault book', metadata: {} })
        .mockImplementationOnce(() => new Promise(() => {}));
    root = createRoot(container);
    await act(async () => { root.render(<Label />); await Promise.resolve(); });
    expect(container.textContent).toBe('First vault book');
    context.vaultId = 'second';
    act(() => { root.render(<Label />); });
    expect(container.textContent).toBe('Unavailable page');
});
