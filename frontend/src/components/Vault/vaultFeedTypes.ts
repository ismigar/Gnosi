import type { ReactNode } from 'react';

import type { BulkActionTemplate } from './VaultBulkActionsBar';
import type { SchemaView, VaultSchema } from './schemaTypes';
import type { TitlePreviewTriggerProps } from './useTitlePreview';
import type { FilterValue } from '../../utils/vaultFilters';


export type VaultFeedDensity = 'adaptive' | 'comfortable' | 'compact';
export type VaultFeedGroupMode = 'date' | 'none';
export type VaultFeedSaveState = 'error' | 'idle' | 'saved' | 'saving';
export type VaultFeedSummaryState = 'error' | 'idle' | 'loading' | 'success';


export interface VaultFeedNote {
  readonly [key: string]: FilterValue;
  readonly created_time?: FilterValue;
  readonly id: string;
  readonly last_modified?: FilterValue;
  readonly metadata?: Readonly<Record<string, FilterValue>>;
  readonly resolved_table_id?: FilterValue;
  readonly title?: string | number | bigint | boolean | null;
}


export interface VaultFeedActiveView extends SchemaView {
  readonly columns?: unknown;
  readonly excerptLines?: unknown;
  readonly excerpt_lines?: unknown;
  readonly feedFocus?: unknown;
  readonly feed_focus?: unknown;
  readonly id?: string | number | null;
  readonly is_default?: unknown;
  readonly is_main?: unknown;
  readonly locked?: unknown;
  readonly name?: string | null;
  readonly order?: number | null;
  readonly table_id?: string | number | null;
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
  readonly next: FilterValue;
  readonly previous: FilterValue;
}


export interface VaultFeedBulkProposal {
  readonly changes: readonly VaultFeedBulkChange[];
  readonly field: string;
  readonly value: string;
}


export interface VaultFeedUpdate {
  readonly metadata: Readonly<Record<string, FilterValue>>;
}


export interface VaultFeedProps {
  readonly activeView?: VaultFeedActiveView;
  readonly allNotes?: readonly VaultFeedNote[];
  readonly density?: VaultFeedDensity;
  readonly groupMode?: VaultFeedGroupMode;
  readonly idToTitle?: Readonly<Record<string, string>>;
  readonly isEmbedded?: boolean;
  readonly notes?: readonly VaultFeedNote[];
  readonly onApplyTemplate?: (ids: ReadonlySet<string>, templateId: string) => void;
  readonly onClearSearch?: () => void;
  readonly onCreateRecord?: () => void;
  readonly onDeletePage?: (id: string, title: string) => void;
  readonly onDeleteSelected?: (ids: ReadonlySet<string>) => void;
  readonly onNoteSelect?: (id: string) => void;
  readonly onOpenConfig?: () => void;
  readonly onSearchChange?: (value: string) => void;
  readonly onUpdateNote?: (
    id: string,
    update: VaultFeedUpdate,
  ) => Promise<unknown>;
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
