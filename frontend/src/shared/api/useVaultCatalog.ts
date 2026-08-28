import { $api } from './client';


export function useVaultCatalog() {
  return $api.useQuery('get', '/api/vaults');
}
