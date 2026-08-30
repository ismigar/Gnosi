import { useEffect, useState } from 'react';

import { useVaultNameChanged } from '../../lib/configEvents';
import { useVaultCatalog } from '../api/useVaultCatalog';
import {
  defineStorageKey,
  readStorage,
  stringStorageCodec,
  writeStorage,
} from '../platform/browser-storage';


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
    const name = active?.name;
    if (!name) return;
    let current = true;
    void Promise.resolve().then(() => {
      if (!current) return;
      setActiveVaultName(name);
      writeStorage(ACTIVE_VAULT_NAME_KEY, name);
    });
    return () => { current = false; };
  }, [vaultCatalog.data]);

  useVaultNameChanged(() => {
    void vaultCatalog.refetch();
  });

  return activeVaultName;
}
