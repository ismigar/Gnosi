import { useEffect, useState } from 'react';

import { useVaultNameChanged } from '../lib/configEvents';
import { useVaultCatalog } from '../shared/api/useVaultCatalog';
import {
  defineStorageKey,
  readStorage,
  stringStorageCodec,
  writeStorage,
} from '../shared/platform/browser-storage';


const ACTIVE_VAULT_NAME_KEY = defineStorageKey(
  'gnosi_active_vault_name',
  stringStorageCodec,
);


export function useActiveVaultName(): string {
  const vaultCatalog = useVaultCatalog();
  const [activeVaultName, setActiveVaultName] = useState(
    () => readStorage(ACTIVE_VAULT_NAME_KEY) ?? '',
  );

  useEffect(() => {
    const active = (vaultCatalog.data?.vaults ?? []).find((vault) => vault.active);
    if (active?.name) {
      setActiveVaultName(active.name);
      writeStorage(ACTIVE_VAULT_NAME_KEY, active.name);
    }
  }, [vaultCatalog.data]);

  useVaultNameChanged(() => {
    void vaultCatalog.refetch();
  });

  return activeVaultName;
}
