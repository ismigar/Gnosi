import type { ComponentType, Dispatch, RefObject, SetStateAction } from 'react';
import type { EffectiveTheme } from '../../../../../shared/hooks/useTheme';
import type { FieldFormat } from '../../../../../shared/records/model/formatUtils';
import type { VaultEditorContextValue, VaultEditorRegistry } from '../../../../../shared/editor/VaultEditorContext';
import type { EditingBlock, SavedView } from '../../../view-config/page-view-modal/types';
import type { PageActionsConfig } from '../../page-actions-bar/pageActionsBarModel';
import type { OutgoingPageLink } from '../outgoingLinks';

export interface PageMetadata extends Record<string, unknown> {
  title?: string;
  icon?: string;
  cover?: string;
  table_id?: string;
  database_table_id?: string;
  resolved_table_id?: string;
  is_dashboard?: boolean;
}
export type PageOption = string | { name: string; color?: string; group?: string;[key: string]: unknown };
export interface PagePropertyConfig extends Record<string, unknown> {
  id?: string;
  options?: PageOption[];
  description?: string;
  format?: FieldFormat | null;
}
export interface PageProperty extends PagePropertyConfig {
  name: string;
  type: string;
  config?: PagePropertyConfig;
  relation_database_id?: string;
  file_mode?: string;
  storage_folder?: string;
  name_pattern?: string;
}
export interface PageTable extends Record<string, unknown> {
  id: string;
  name?: string;
  properties?: PageProperty[];
}
export interface PageNote extends Record<string, unknown> {
  id: string;
  title?: string;
  resolved_table_id?: string;
  metadata?: PageMetadata;
}
export interface PagePatch { title: string; metadata: PageMetadata }
export type PageUpdate = (id: string, content?: unknown, patch?: PagePatch) => void;
export interface PageEditorApi {
  focusFirstBlock?: () => void;
  focusLastBlock?: () => void;
}
export interface ViewEditingBlock extends Omit<EditingBlock, 'props'> {
  id?: string;
  props?: { heading?: string; heading_level?: string | number; view_id?: string; section?: string };
}
export type ApplyViewSection = (section: SavedView, editing: ViewEditingBlock | null) => void;
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type CompactPanel = 'properties' | 'links';
export interface SaveMetadataOptions { immediate?: boolean; removeKeys?: string[] }
export interface PropertyEntry { name: string; type: string; prop: PageProperty | null }
export interface PropertyClipboard { value: unknown; type: string }
export interface PageEditorProps {
  noteFilename: string;
  initialContent?: unknown;
  initialMetadata?: PageMetadata;
  onUpdate?: PageUpdate;
  allTables?: PageTable[];
  allNotes?: PageNote[];
  onEditSchema?: (table: PageTable) => void;
  onAddSchemaOption?: (tableId: string, fieldId: string, options: PageOption[]) => void;
  onCreateRecord?: (tableId: string, metadata?: PageMetadata, template?: PageNote | null) => unknown;
  onCreateTemplate?: (tableId: string) => unknown;
  onCreateFromSource?: (tableId?: string | null) => unknown;
  onDeletePage?: (pageId: string) => unknown;
  onOpenParallel?: (pageId: string) => unknown;
  onOpenPage?: (pageId: string) => unknown;
  onOpenInCurrentTab?: ((pageId: string) => unknown) | null;
  onOpenInNewTab?: ((pageId: string) => unknown) | null;
  idToTitle?: Readonly<Record<string, string>>;
  aliasIndex?: Readonly<Record<string, readonly string[]>>;
  registry?: VaultEditorRegistry | null;
  onRefreshNotes?: () => void;
  onUpdatePageMetadata?: (pageId: string, metadata: PageMetadata) => void;
  historyOpenSignal?: number;
  isCodeView?: boolean;
  isEditLocked?: boolean;
  referenceTableId?: string | null;
  onOpenViewConfig?: (view: Record<string, unknown>, onSaved?: (view: Record<string, unknown>) => void) => unknown;
  pageActions?: PageActionsConfig | null;
  isActivePage?: boolean;
  EditorInner: ComponentType<PageEditorBodyProps>;
}
export type PublicBlockEditorProps = Omit<PageEditorProps, 'EditorInner'>;

/** Bridge injected by the compatibility facade; page-editor never imports its parent. */
export interface PageEditorBodyProps {
  noteFilename: string;
  initialContent?: unknown;
  metadata: PageMetadata;
  onUpdate?: PageUpdate;
  idToTitle: Readonly<Record<string, string>>;
  aliasIndex: Readonly<Record<string, readonly string[]>>;
  onRefreshNotes: () => void;
  onUpdatePageMetadata?: PageEditorProps['onUpdatePageMetadata'];
  effectiveTheme: EffectiveTheme;
  contextValue: VaultEditorContextValue;
  saveStatus: SaveStatus;
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  metadataRef: RefObject<PageMetadata>;
  isEditable: boolean;
  onOpenPageViewModal: (tableId?: string, editingBlock?: ViewEditingBlock | null) => void;
  applyViewSectionRef: RefObject<ApplyViewSection | null>;
  registerEditorApi: (api: PageEditorApi | null) => void;
  onNavigateUp: () => void;
  onOpenProperties: () => void;
  spellEnabled: boolean;
  spellLang: string;
  onLangDetected: (language: string) => void;
  onOutgoingLinksChange: (links: OutgoingPageLink[]) => void;
}
