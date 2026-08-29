import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  USER_EMAIL_STORAGE_KEY,
  USER_ID_STORAGE_KEY,
} from '../shared/api/request-context';
import { fetchSystemHealth } from '../shared/api/system';
import {
  removeStorage,
  writeStorage,
} from '../shared/platform/browser-storage';
import {
  collaborationColorFor,
  useYjsCollaboration,
  type UseYjsCollaborationResult,
} from './useYjsCollaboration';


interface CreatedProvider {
  readonly pageId: string;
  readonly user: { readonly color: string; readonly name: string } | undefined;
}


const providerState = vi.hoisted(() => ({
  created: [] as CreatedProvider[],
  destroy: vi.fn<() => void>(),
}));


vi.mock('../lib/collabProvider', () => ({
  GnosiCollabProvider: class MockCollaborationProvider {
    constructor(
      pageId: string,
      _document: unknown,
      user?: CreatedProvider['user'],
    ) {
      providerState.created.push({ pageId, user });
    }

    destroy(): void {
      providerState.destroy();
    }
  },
}));


vi.mock('../shared/api/system', () => ({
  fetchSystemHealth: vi.fn(),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


interface HarnessProps {
  readonly onResult: (result: UseYjsCollaborationResult) => void;
}


function Harness({ onResult }: HarnessProps): null {
  const result = useYjsCollaboration('page-7');
  React.useEffect(() => {
    onResult(result);
  }, [onResult, result]);
  return null;
}


describe('useYjsCollaboration', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    providerState.created.length = 0;
    providerState.destroy.mockClear();
    writeStorage(USER_ID_STORAGE_KEY, 'user-7');
    writeStorage(USER_EMAIL_STORAGE_KEY, 'Ada@example.test');
    vi.mocked(fetchSystemHealth).mockResolvedValue({
      gnosi_mode: 'org',
      mode: 'FastAPI',
      require_auth: true,
      status: 'ok',
      vault_configured: true,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    removeStorage(USER_ID_STORAGE_KEY);
    removeStorage(USER_EMAIL_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('creates organization collaboration with typed identity and cleans it up', async () => {
    const onResult = vi.fn<(result: UseYjsCollaborationResult) => void>();
    act(() => {
      root.render(<Harness onResult={onResult} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const latestResult = onResult.mock.calls.at(-1)?.at(0);
    expect(latestResult?.ready).toBe(true);
    expect(providerState.created).toEqual([{
      pageId: 'page-7',
      user: {
        color: collaborationColorFor('user-7'),
        name: 'Ada',
      },
    }]);

    act(() => {
      root.unmount();
    });
    expect(providerState.destroy).toHaveBeenCalledOnce();
    root = createRoot(container);
  });
});
