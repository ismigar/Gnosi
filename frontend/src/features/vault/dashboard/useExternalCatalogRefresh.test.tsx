// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useExternalCatalogRefresh } from './useExternalCatalogRefresh';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';

const scope = vi.hoisted(() => ({ id: 'a' }));
vi.mock('../../../shared/hooks/useActiveVaultId', () => ({ useActiveVaultId: () => scope.id }));
vi.mock('../../../shared/api/vault-context', () => ({ getActiveVaultId: () => scope.id }));
let root: Root;
let host: HTMLDivElement;
const load = vi.fn<(signal: AbortSignal) => Promise<string[]>>();
const apply = vi.fn();
function Harness() {
    useExternalCatalogRefresh(load, apply);
    return <textarea defaultValue="unsaved draft" />;
}
beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    scope.id = 'a';
    load.mockReset().mockResolvedValue(['external-page']);
    apply.mockReset();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root.render(<Harness />); await Promise.resolve(); });
});
afterEach(async () => {
    await act(async () => { root.unmount(); await Promise.resolve(); });
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
it('refreshes on focus and visible ticks without touching an editor draft', async () => {
    await act(async () => { dispatchWindowEvent(new Event('focus')); await Promise.resolve(); });
    expect(apply).toHaveBeenCalledWith(['external-page']);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.querySelector('textarea')?.value).toBe('unsaved draft');
});
it('does not poll hidden windows and retries after a failed request', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(load).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    load.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    expect(apply).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(apply).toHaveBeenCalledOnce();
});
it('prevents overlapping refresh and ignores a previous vault response', async () => {
    let finish!: (rows: string[]) => void;
    load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { dispatchWindowEvent(new Event('focus')); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(load).toHaveBeenCalledOnce();
    scope.id = 'b';
    await act(async () => { root.render(<Harness />); await Promise.resolve(); });
    expect(load.mock.calls[0]?.[0].aborted).toBe(true);
    await act(async () => { finish(['wrong-vault']); await Promise.resolve(); });
    expect(apply).not.toHaveBeenCalled();
});
