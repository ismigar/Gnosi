import { useQuery } from '@tanstack/react-query';

import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { fetchVaultCatalogUncached } from './vaults';


export function useVaultCatalog() {
  return useQuery({
    queryFn: ({ signal }) => fetchVaultCatalogUncached(signal),
    queryKey: bootstrapQueryKeys.vaultCatalog,
  });
}
