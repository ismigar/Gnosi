import { useMemo, useSyncExternalStore } from 'react';

import { currentRequestContext } from '../api/request-context';
import { subscribeAppEvent } from '../platform/app-events';
import { subscribeWindowEvent } from '../platform/browser-events';

function subscribe(listener: () => void): () => void {
  const stopVault = subscribeAppEvent('gnosi:vault-changed', listener);
  const stopStorage = subscribeWindowEvent('storage', listener);
  const stopFocus = subscribeWindowEvent('focus', listener);
  return () => { stopVault(); stopStorage(); stopFocus(); };
}

/** A stable request scope that also notices another tab changing accounts. */
export function useRequestContext() {
  useSyncExternalStore(subscribe, () => JSON.stringify(currentRequestContext()), () => '');
  const { userId, userEmail, vaultId, workspaceId } = currentRequestContext();
  return useMemo(() => ({ userId, userEmail, vaultId, workspaceId }), [userId, userEmail, vaultId, workspaceId]);
}
