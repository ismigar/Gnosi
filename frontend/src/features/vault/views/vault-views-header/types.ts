import type { CSSProperties, RefObject } from 'react';

import type {
    FilterItem,
    FilterNode,
} from '../../../../shared/filtering/vaultFilters';

export type ViewAction = 'configure' | 'delete' | 'duplicate' | 'rename';

export interface HeaderView {
    readonly [key: string]: unknown;
    readonly embedded?: boolean | null;
    readonly filterTree?: FilterNode;
    readonly filters?: readonly FilterNode[];
    readonly hidden?: boolean | null;
    readonly id: string;
    readonly is_default?: boolean | null;
    readonly is_locked?: boolean | null;
    readonly is_main?: boolean | null;
    readonly locked?: boolean | null;
    readonly name?: string | null;
    readonly order?: number | null;
    readonly table_id?: string | null;
    readonly type?: string | null;
}

export interface HeaderTemplateMetadata {
    readonly [key: string]: unknown;
    readonly 'Item Type'?: string | null;
    readonly Icon?: string | null;
    readonly Icona?: string | null;
    readonly icon?: string | null;
    readonly is_default_template?: boolean | null;
    readonly itemType?: string | null;
    readonly item_type?: string | null;
}

export interface HeaderTemplate {
    readonly [key: string]: unknown;
    readonly icon?: string | null;
    readonly id: string;
    readonly metadata?: HeaderTemplateMetadata | null;
    readonly title?: string | null;
}

export interface TemplateMenuState {
    readonly id: string;
    readonly right: number;
    readonly top: number;
    readonly tpl: HeaderTemplate;
}

export interface ViewActionHandler {
    (view: HeaderView, action: ViewAction): void;
}

export interface VaultViewsHeaderProps {
    readonly activeViewId?: string | null;
    readonly brainTableId?: string | null;
    readonly notes?: readonly FilterItem[];
    readonly onAddView: (viewType: string) => unknown;
    readonly onClose?: (() => unknown) | null;
    readonly onCreateFromSource?: (() => unknown) | null;
    readonly onCreateRecord?: ((templateId?: string) => unknown) | null;
    readonly onCreateTemplate?: (() => unknown) | null;
    readonly onDeleteTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly onDeleteView?: ((view: HeaderView) => unknown) | null;
    readonly onDuplicateTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly onDuplicateView?: ((view: HeaderView) => unknown) | null;
    readonly onEditSchema?: ((section: string) => unknown) | null;
    readonly onEditTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly onEditView?: ((view: HeaderView) => unknown) | null;
    readonly onReferencesImported?: (() => unknown) | null;
    readonly onRenameView?: ((view: HeaderView) => unknown) | null;
    readonly onReorderViews?: ((views: readonly HeaderView[]) => unknown) | null;
    readonly onSetDefaultTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly onViewSelect?: ((viewId: string) => unknown) | null;
    readonly recordCount: number;
    readonly referenceTableId?: string | null;
    readonly searchTerm: string;
    readonly setSearchTerm: (value: string) => unknown;
    readonly tableName: string;
    readonly templates?: readonly HeaderTemplate[];
    readonly views: readonly HeaderView[];
}

export interface ViewMenuPosition extends CSSProperties {
    readonly right: number;
    readonly top: number;
}

export interface ViewTabsRefs {
    readonly actionsRef: RefObject<HTMLDivElement | null>;
    readonly addViewButtonRef: RefObject<HTMLButtonElement | null>;
    readonly containerRef: RefObject<HTMLDivElement | null>;
}
