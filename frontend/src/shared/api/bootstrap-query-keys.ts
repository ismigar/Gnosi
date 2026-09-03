import { getActiveVaultId } from './vault-context';

export const bootstrapQueryKeys = {
  health: ['bootstrap', 'health'] as const,
  vaultCatalog: ['bootstrap', 'vault-catalog'] as const,
  brainTable: (): readonly unknown[] => ['bootstrap', 'brain-table', getActiveVaultId() || ''],
  referenceTable: (): readonly unknown[] => ['bootstrap', 'reference-table', getActiveVaultId() || ''],
};
