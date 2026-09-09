import { getActiveVaultId } from './vault-context';

export const bootstrapQueryKeys = {
  health: ['bootstrap', 'health'] as const,
  vaultCatalog: ['bootstrap', 'vault-catalog'] as const,
  configuration: ['bootstrap', 'configuration'] as const,
  editorConfiguration: (): readonly unknown[] => ['bootstrap', 'editor-configuration', getActiveVaultId() || ''],
  interfaceSettings: (): readonly unknown[] => ['bootstrap', 'interface-settings', getActiveVaultId() || ''],
  vaultRegistry: (): readonly unknown[] => ['bootstrap', 'vault-registry', getActiveVaultId() || ''],
  vaultTables: (databaseId?: string): readonly unknown[] => ['bootstrap', 'vault-tables', getActiveVaultId() || '', databaseId ?? null],
  vaultTablePages: (tableId: string, query: Readonly<Record<string, unknown>>): readonly unknown[] => ['bootstrap', 'vault-table-pages', getActiveVaultId() || '', tableId, query],
  vaultTablePageReferences: (tableId: string, query: Readonly<Record<string, unknown>>): readonly unknown[] => ['bootstrap', 'vault-table-page-references', getActiveVaultId() || '', tableId, query],
  vaultSidebar: (): readonly unknown[] => ['bootstrap', 'vault-sidebar', getActiveVaultId() || ''],
  brainTable: (): readonly unknown[] => ['bootstrap', 'brain-table', getActiveVaultId() || ''],
  llmWikiConfig: (): readonly unknown[] => ['bootstrap', 'llm-wiki-config', getActiveVaultId() || ''],
  referenceTable: (): readonly unknown[] => ['bootstrap', 'reference-table', getActiveVaultId() || ''],
};
