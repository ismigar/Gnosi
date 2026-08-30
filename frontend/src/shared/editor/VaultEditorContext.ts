import { createContext } from 'react';


export type VaultEditorCallback = (...args: unknown[]) => unknown;


export interface VaultEditorRegistry {
  readonly databases: readonly unknown[];
  readonly tables: readonly unknown[];
  readonly views: readonly unknown[];
}


export interface VaultEditorContextValue {
  readonly [key: string]: unknown;
  readonly allTables: readonly unknown[];
  readonly idToTitle: Readonly<Record<string, string>>;
  readonly onCreateRecord: VaultEditorCallback | null;
  readonly onDeletePage: VaultEditorCallback | null;
  readonly onEditSchema: VaultEditorCallback | null;
  readonly onOpenInCurrentTab?: VaultEditorCallback | null;
  readonly onOpenInNewTab?: VaultEditorCallback | null;
  readonly onOpenPage?: VaultEditorCallback | null;
  readonly onOpenPageViewModal?: VaultEditorCallback | null;
  readonly onOpenParallel: VaultEditorCallback | null;
  readonly onOpenViewConfig?: VaultEditorCallback | null;
  readonly pageId: string | null;
  readonly registry: VaultEditorRegistry;
}


export const VaultEditorContext = createContext<VaultEditorContextValue>({
  allTables: [],
  idToTitle: {},
  onCreateRecord: null,
  onDeletePage: null,
  onEditSchema: null,
  onOpenParallel: null,
  pageId: null,
  registry: { databases: [], tables: [], views: [] },
});
