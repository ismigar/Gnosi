import { act, StrictMode, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDraftAutosave } from './useDraftAutosave';
let root: Root;
let host: HTMLDivElement;
let result: ReturnType<typeof useDraftAutosave<string>>;
const save = vi.fn<(value: string) => Promise<void>>();
function Harness({ value, valid = true, initial = false }: { value: string; valid?: boolean; initial?: boolean }) {
    const autosave = useDraftAutosave(value, valid, save, initial);
    useLayoutEffect(() => { result = autosave; }, [autosave]);
    return <span>{autosave.status}</span>;
}
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers(); save.mockReset().mockResolvedValue();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(value: string, valid = true, initial = false) {
    await act(async () => { root.render(<StrictMode><Harness value={value} valid={valid} initial={initial} /></StrictMode>); await Promise.resolve(); });
}
it('debounces typing, flushes the last edit immediately on close and never saves opening unchanged forms', async () => {
    await render('original'); expect(save).not.toHaveBeenCalled();
    await render('first'); await render('latest');
    expect(save).not.toHaveBeenCalled();
    await act(async () => { expect(await result.flush()).toBe(true); });
    expect(save.mock.calls).toEqual([['latest']]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(1);
});
it('serializes writes and drains the newest draft before closing', async () => {
    let complete: (() => void) | undefined;
    save.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    await render('original'); await render('first');
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await render('last');
    let closing: Promise<boolean>;
    act(() => { closing = result.flush(); });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { complete?.(); expect(await closing).toBe(true); });
    expect(save.mock.calls).toEqual([['first'], ['last']]);
});
it('keeps failed edits pending, retries on close and refuses incomplete drafts', async () => {
    await render('original'); await render('changed'); save.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { expect(await result.flush()).toBe(false); });
    expect(host.textContent).toBe('error');
    await act(async () => { expect(await result.flush()).toBe(true); });
    await render('', false);
    await act(async () => { expect(await result.flush()).toBe(false); });
    expect(save).toHaveBeenCalledTimes(2);
});
it('saves an adopted draft once under StrictMode and flushes edits on unmount', async () => {
    await render('draft', true, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(save.mock.calls).toEqual([['draft']]);
    await render('edited');
    await act(async () => { root.unmount(); await Promise.resolve(); });
    expect(save.mock.calls).toEqual([['draft'], ['edited']]);
});
