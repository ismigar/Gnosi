/** Minimal record boundary: all unknown metadata belongs to the persisted vault schema. */
export interface TableRowRecord {
  readonly id: string;
  readonly title?: string;
  readonly parent_id?: string;
  readonly resolved_table_id?: string;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface TableGroupMetadata {
  readonly fieldId: string | null;
  readonly optionOrder: readonly string[];
  readonly colorMap: Readonly<Record<string, string>>;
  readonly labelMap: Readonly<Record<string, string>> | null;
}

export interface TableGroupSort {
  readonly groupSort?: string;
  readonly group_sort?: string;
  readonly groupSortDir?: string;
  readonly group_sort_dir?: string;
}

export type TableRowDescriptor<Note extends TableRowRecord> =
  | { readonly kind: 'row'; readonly note: Note; readonly isChild: boolean; readonly depth: number; }
  | { readonly kind: 'new-subitem'; readonly parentNote: Note; readonly depth: number; }
  | { readonly kind: 'group-header'; readonly groupKey: string; readonly label: string; readonly count: number; readonly colorHex: string | null; }
  | { readonly kind: 'group-footer'; readonly groupKey: string; readonly notes: readonly Note[]; };

export interface TableRowDescriptorInput<Note extends TableRowRecord> {
  readonly groupByField: string;
  readonly groupMeta: TableGroupMetadata | null;
  readonly visibleRootNotes: readonly Note[];
  readonly sortedNotes: readonly Note[];
  readonly expandedRows: ReadonlySet<string>;
  readonly childrenMap: Readonly<Record<string, readonly Note[]>>;
  readonly addingSubitemFor: string | null;
  readonly expandedGroups: ReadonlySet<string>;
  readonly hasGroupAggregations: boolean;
  readonly activeView?: TableGroupSort | null;
  readonly emptyGroupLabel: string;
}
