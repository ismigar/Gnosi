import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { fetchVaultCatalogUncached, type VaultCatalog } from './vaults';
import { withActiveVaultSelection } from './vault-context';
import { useActiveVaultId } from '../hooks/useActiveVaultId';


export function useVaultCatalog() {
  const activeId = useActiveVaultId();
  return useQuery({
    queryFn: ({ signal }) => fetchVaultCatalogUncached(signal),
    queryKey: bootstrapQueryKeys.vaultCatalog,
    select: useCallback((data: VaultCatalog) => ({
      ...data,
      vaults: withActiveVaultSelection(data.vaults, activeId),
    }), [activeId]),
  });
}
