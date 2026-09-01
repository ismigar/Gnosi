import type { ReactNode } from 'react';

import type { BulkActionTemplate } from '../../../shared/record-views/VaultBulkActionsBar';
import type { SchemaView, VaultSchema } from '../../../shared/records/model/schemaTypes';
import type { TitlePreviewTriggerProps } from '../../../shared/editor/useTitlePreview';
import type { VaultViewPage } from '../../../shared/records/hooks/useVaultViewData';


export type VaultFeedDensity = string;
export type VaultFeedGroupMode = string;
export type VaultFeedSaveState = 'error' | 'idle' | 'saved' | 'saving';
export type VaultFeedSummaryState = 'error' | 'idle' | 'loading' | 'success';


export type VaultFeedNote = VaultViewPage;


export interface VaultFeedActiveView extends SchemaView {
  readonly columns?: unknown;
  readonly excerptLines?: unknown;
  readonly excerpt_lines?: unknown;
  readonly feedFocus?: unknown;
  readonly feed_focus?: unknown;
  readonly is_default?: unknown;
  readonly is_main?: unknown;
  readonly locked?: unknown;
  readonly pillLimit?: unknown;
  readonly pill_limit?: unknown;
  readonly summaryModel?: unknown;
  readonly summary_model?: unknown;
  readonly visibleProperties?: unknown;
  readonly visible_properties?: unknown;
}


export interface VaultFeedPill {
  readonly key: string;
  readonly node: ReactNode;
}


export interface VaultFeedBulkChange {
  readonly field: string;
  readonly id: string;
  readonly next: unknown;
  readonly previous: unknown;
}


export interface VaultFeedBulkProposal {
  readonly changes: readonly VaultFeedBulkChange[];
  readonly field: string;
  readonly value: string;
}


export interface VaultFeedUpdate {
  readonly metadata: Readonly<Record<string, unknown>>;
}


export interface VaultFeedProps {
  readonly activeView?: VaultFeedActiveView;
  readonly allNotes?: readonly VaultFeedNote[];
  readonly density?: VaultFeedDensity;
  readonly groupMode?: VaultFeedGroupMode;
  readonly idToTitle?: Readonly<Record<string, string>>;
  readonly isEmbedded?: boolean;
  readonly notes?: readonly VaultFeedNote[];
  readonly onApplyTemplate?: (ids: Set<string>, templateId: string) => void;
  readonly onClearSearch?: () => void;
  readonly onCreateRecord?: () => void;
  readonly onDeletePage?: (id: string, title: string) => void;
  readonly onDeleteSelected?: (ids: Set<string>) => void;
  readonly onNoteSelect?: (id: string) => void;
  readonly onOpenConfig?: () => void;
  readonly onSearchChange?: (value: string) => void;
  readonly onUpdateNote?: (
    id: string,
    update: VaultFeedUpdate,
  ) => unknown;
  readonly schema?: VaultSchema;
  readonly searchTerm?: string;
  readonly templates?: readonly BulkActionTemplate[];
}


export interface VaultFeedCardProps {
  readonly density: VaultFeedDensity;
  readonly excerptLines: number;
  readonly isRead: boolean;
  readonly isSelected: boolean;
  readonly note: VaultFeedNote;
  readonly onOpen: (id: string) => void;
  readonly onPreview: (id: string) => void;
  readonly onToggleSelect: (id: string, shiftKey: boolean) => void;
  readonly pillLimit: number;
  readonly pills: readonly VaultFeedPill[];
  readonly searchTerm: string;
  readonly selectionActive: boolean;
  readonly titlePreviewProps: TitlePreviewTriggerProps;
}
