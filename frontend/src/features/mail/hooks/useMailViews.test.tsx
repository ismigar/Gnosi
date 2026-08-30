import React, { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GnosiApiError } from '../../../shared/api/errors';
import * as mailApi from '../../../shared/api/mail';
import type { MailView } from '../../../shared/api/mail';
import { useMailViews } from './useMailViews';


vi.mock('../../../shared/api/mail', () => ({
  createMailView: vi.fn(),
  deleteMailView: vi.fn(),
  fetchMailViews: vi.fn(),
  updateMailView: vi.fn(),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


type MailViewsValue = ReturnType<typeof useMailViews>;
interface HookValueRef { current: MailViewsValue | null; }


const hookValueRef: HookValueRef = { current: null };
let container: HTMLDivElement | null = null;
let root: Root | null = null;


beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mailApi.fetchMailViews).mockResolvedValue([]);
  hookValueRef.current = null;
});


afterEach(async () => {
  const mountedRoot = root;
  if (mountedRoot) {
    await act(async () => {
      mountedRoot.unmount();
      await Promise.resolve();
    });
  }
  container?.remove();
  container = null;
  root = null;
});


function Probe({ valueRef }: { readonly valueRef: HookValueRef }): null {
  const value = useMailViews();
  useEffect(() => {
    valueRef.current = value;
  }, [value, valueRef]);
  return null;
}


async function renderHook(strict = false): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    const probe = <Probe valueRef={hookValueRef} />;
    root?.render(strict ? <StrictMode>{probe}</StrictMode> : probe);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}


function currentHook(): MailViewsValue {
  const value = hookValueRef.current;
  if (!value) throw new Error('Mail views hook did not mount');
  return value;
}


function mailView(id: string, name: string): MailView {
  return {
    actions: [],
    created_at: null,
    fields: [],
    filter_logic: 'and',
    filters: [],
    group_by: '',
    id,
    name,
    sort_by: '',
    sort_dir: 'asc',
    updated_at: null,
  };
}


function httpError(): GnosiApiError {
  return new GnosiApiError(
    new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    }),
    { detail: 'backend failure' },
  );
}


describe('useMailViews', () => {
  it('does not load from the discarded StrictMode effect', async () => {
    await renderHook(true);
    expect(mailApi.fetchMailViews).toHaveBeenCalledTimes(1);
    expect(currentHook().loading).toBe(false);
  });

  it('cancels initial synchronization when unmounted before it starts', async () => {
    const pending: VoidFunction[] = [];
    const schedule = vi.spyOn(globalThis, 'queueMicrotask')
      .mockImplementation(callback => { pending.push(callback); });
    try {
      await renderHook();
      expect(mailApi.fetchMailViews).not.toHaveBeenCalled();
      act(() => { root?.unmount(); });
      root = null;
      schedule.mockRestore();
      await act(async () => {
        pending.forEach(callback => { callback(); });
        await Promise.resolve();
      });
      expect(mailApi.fetchMailViews).not.toHaveBeenCalled();
    } finally {
      schedule.mockRestore();
    }
  });

  it('preserves state and mutation behavior with typed API helpers', async () => {
    const initial = mailView('view-1', 'Initial');
    const created = mailView('view-2', 'Created');
    const updated = mailView('view-2', 'Updated');
    vi.mocked(mailApi.fetchMailViews).mockResolvedValue([initial]);
    vi.mocked(mailApi.createMailView).mockResolvedValue(created);
    vi.mocked(mailApi.updateMailView).mockResolvedValue(updated);
    vi.mocked(mailApi.deleteMailView).mockResolvedValue(undefined);

    await renderHook();
    expect(currentHook().loading).toBe(false);
    expect(currentHook().error).toBeNull();
    expect(currentHook().views).toEqual([initial]);

    await act(async () => {
      await currentHook().createView({ name: 'Created' });
    });
    expect(currentHook().views).toEqual([initial, created]);

    await act(async () => {
      await currentHook().updateView('view-2', { name: 'Updated' });
    });
    expect(currentHook().views).toEqual([initial, updated]);

    await act(async () => {
      await currentHook().deleteView('view-1');
    });
    expect(currentHook().views).toEqual([updated]);
  });

  it('keeps legacy fetch and mutation messages for HTTP failures', async () => {
    vi.mocked(mailApi.fetchMailViews).mockRejectedValueOnce(httpError());
    await renderHook();
    expect(currentHook().error).toBe('Error loading views');
    expect(currentHook().loading).toBe(false);

    vi.mocked(mailApi.deleteMailView).mockRejectedValueOnce(httpError());
    await expect(currentHook().deleteView('view-1'))
      .rejects.toThrow('Error eliminant vista');
  });

  it('keeps the original network error when loading fails early', async () => {
    vi.mocked(mailApi.fetchMailViews).mockRejectedValueOnce(
      new Error('network unavailable'),
    );
    await renderHook();
    expect(currentHook().error).toBe('network unavailable');
  });
});
