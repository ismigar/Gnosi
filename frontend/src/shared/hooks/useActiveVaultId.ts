import { useSyncExternalStore } from 'react';

import { getActiveVaultId } from '../api/vault-context';
import { subscribeAppEvent } from '../platform/app-events';

function subscribe(listener: () => void): () => void {
  return subscribeAppEvent('gnosi:vault-changed', listener);
}

export function useActiveVaultId(): string {
  return useSyncExternalStore(subscribe, getActiveVaultId, () => '');
}
