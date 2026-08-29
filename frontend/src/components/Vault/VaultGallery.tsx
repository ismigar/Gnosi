import type { ComponentType, Dispatch, SetStateAction } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';
import {
    useVaultViewData,
    type VaultSortInput,
    type VaultViewConfig,
} from '../../hooks/useVaultViewData';
import type { FilterNode } from '../../utils/vaultFilters';
import { VaultBulkActionsBar as LegacyVaultBulkActionsBar } from './VaultBulkActionsBar';
import { VaultViewToolbar } from './VaultViewToolbar';
import { getFieldType, getSchemaFieldNames, resolveViewFilters, resolveViewSorts } from './schemaUtils';
import { useTitlePreview } from './useTitlePreview';
import { isMainView } from './viewConstants';
import { VaultGalleryCard } from './vault-gallery/VaultGalleryCard';
import { VaultGallerySections } from './vault-gallery/VaultGallerySections';
import {
    buildGallerySections,
    type GalleryCardSize,
    type GalleryNote,
    type GalleryPreviewMode,
    type GallerySchema,
    type GalleryView,
} from './vault-gallery/vaultGalleryModel';
import {
    useVaultGalleryNavigation,
    type VaultGalleryNavigationApi,
} from './vault-gallery/useVaultGalleryNavigation';


interface VaultGalleryProps {
    readonly activeView?: GalleryView;
    readonly allNotes?: readonly GalleryNote[];
    readonly idToTitle?: Readonly<Record<string, string>>;
    readonly notes?: readonly GalleryNote[];
    readonly onApplyTemplate?: (selectedIds: Set<string>, templateId: string) => void;
    readonly onCreateRecord?: () => void;
    readonly onDeletePage?: (pageId: string, title: string) => void;
    readonly onDeleteSelected?: (selectedIds: Set<string>) => void;
    readonly onEditSchema?: (section: string) => void;
    readonly onExitBottom?: () => void;
    readonly onExitTop?: () => void;
    readonly onFocusShell?: () => void;
    readonly onNoteSelect: (noteId: string) => void;
    readonly onOpenParallel?: (noteId: string) => void;
    readonly onUpdateNote?: (
        pageId: string,
        patch: { readonly metadata: Record<string, string[]> },
    ) => unknown;
    readonly registerNavApi?: (api: VaultGalleryNavigationApi | null) => void;
    readonly schema?: GallerySchema;
    readonly searchTerm?: string;
    readonly templates?: readonly unknown[];
}


interface BulkActionsProps {
    readonly onApplyTemplate: ((templateId: string) => void) | null;
    readonly onClearSelection: () => void;
    readonly onDeleteSelected: (() => void) | null;
    readonly onSelectAll: () => void;
    readonly selectedIds: ReadonlySet<string>;
    readonly templates: readonly unknown[];
    readonly totalCount: number;
}


const VaultBulkActionsBar = LegacyVaultBulkActionsBar as unknown as ComponentType<
    BulkActionsProps
>;
const readFieldNames = getSchemaFieldNames as (schema: GallerySchema) => string[];
const readFieldType = getFieldType as (schema: GallerySchema, field: string) => string;
const readFilters = resolveViewFilters as (view: GalleryView) => FilterNode[];
const readSorts = resolveViewSorts as (
    view: GalleryView,
    fallback?: VaultSortInput,
) => VaultSortInput[];


export function VaultGallery(props: VaultGalleryProps) {
    const activeView = props.activeView ?? {};
    const groupBy = activeView.groupBy ?? activeView.group_by ?? '';
    return <VaultGalleryContent
        key={`${activeView.id ?? 'view'}:${groupBy}`}
        {...props}
        activeView={activeView}
    />;
}


function VaultGalleryContent({
    activeView = {},
    allNotes = [],
    idToTitle = {},
    notes = [],
    onApplyTemplate,
    onCreateRecord,
    onDeletePage,
    onDeleteSelected,
    onEditSchema,
    onExitBottom,
    onExitTop,
    onFocusShell,
    onNoteSelect,
    onOpenParallel,
    onUpdateNote,
    registerNavApi,
    schema = {},
    searchTerm: externalSearchTerm,
    templates = [],
}: VaultGalleryProps) {
    const { t } = useTranslation();
    const localeSettings = useLocaleSettings();
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
    const searchTerm = externalSearchTerm ?? internalSearchTerm;
    const view = useMemo<VaultViewConfig>(() => ({
        filters: readFilters(activeView),
        search: searchTerm,
        sorts: readSorts(activeView, { direction: 'desc', field: 'last_modified' }),
    }), [activeView, searchTerm]);
    const { sortedPages } = useVaultViewData({ pages: notes, schema, searchTerm, view });
    const visibleNotes = sortedPages as GalleryNote[];
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
    const selection = useVaultSelection(visibleNotes);

    const handleBulkDelete = useCallback((): void => {
        if (selection.selectedIds.size === 0) return;
        if (onDeleteSelected) onDeleteSelected(new Set(selection.selectedIds));
        else if (onDeletePage) selection.selectedIds.forEach((id) => {
            const note = notes.find((candidate) => candidate.id === id);
            if (note) onDeletePage(id, note.title);
        });
        selection.clearSelection();
    }, [notes, onDeletePage, onDeleteSelected, selection]);

    useVaultSelectionShortcuts({
        clearSelection: selection.clearSelection,
        onDeleteSelected: handleBulkDelete,
        selectAll: () => {
            selection.selectAll(visibleNotes.map(({ id }) => id));
        },
    });

    const groupedSections = useMemo(() => buildGallerySections(
        visibleNotes,
        schema,
        activeView,
    ), [activeView, schema, visibleNotes]);
    const navigation = useVaultGalleryNavigation({
        expandedGroups,
        groupedSections,
        onExitBottom,
        onExitTop,
        onFocusShell,
        onNoteSelect,
        openKeyboardPreview: titlePreview.openForKeyboard,
        registerNavApi,
        setExpandedGroups,
    });

    const configuredProperties = activeView.visibleProperties?.length
        ? [...activeView.visibleProperties]
        : isMainView(activeView)
            ? readFieldNames(schema)
            : readFieldNames(schema).slice(0, 3);
    const dynamicColumns = configuredProperties
        .map((field): readonly [string, string] => [field, readFieldType(schema, field)])
        .filter(([, type]) => Boolean(type) && type !== 'title');
    const cardSize: GalleryCardSize = activeView.cardSize ?? 'medium';
    const previewMode: GalleryPreviewMode = activeView.galleryPreview ?? 'cover';

    return <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-primary)]">
        {externalSearchTerm === undefined ? <div className="flex items-center justify-between gap-2">
            <VaultViewToolbar
                activeFiltersCount={readFilters(activeView).length}
                activeSortsCount={readSorts(activeView).length}
                onOpenConfig={onEditSchema ? () => {
                    onEditSchema('settings');
                } : undefined}
                onOpenFilters={() => onEditSchema?.('filters')}
                onOpenSort={() => onEditSchema?.('sorts')}
                searchTerm={searchTerm}
                setSearchTerm={setInternalSearchTerm}
                setShowSearch={setShowSearch}
                showSearch={showSearch}
            />
            {onCreateRecord ? <button
                className="btn-gnosi inline-flex items-center gap-1.5"
                onClick={onCreateRecord}
                type="button"
            >
                <Plus size={14} />
                {t('view.add_record', { defaultValue: 'Add record' })}
            </button> : null}
        </div> : null}
        {selection.selectedIds.size > 0 ? <VaultBulkActionsBar
            onApplyTemplate={onApplyTemplate ? (templateId) => {
                onApplyTemplate(new Set(selection.selectedIds), templateId);
                selection.clearSelection();
            } : null}
            onClearSelection={selection.clearSelection}
            onDeleteSelected={onDeleteSelected || onDeletePage ? handleBulkDelete : null}
            onSelectAll={() => {
                selection.selectAll(visibleNotes.map(({ id }) => id));
            }}
            selectedIds={selection.selectedIds}
            templates={templates}
            totalCount={visibleNotes.length}
        /> : null}
        <div className="custom-scrollbar flex-1 overflow-y-auto px-4 pb-4 pt-vault-header-top md:px-6 md:pb-6">
            <VaultGallerySections
                cardSize={cardSize}
                expandedGroups={expandedGroups}
                groupHeaderRefs={navigation.groupHeaderRefs}
                groupedSections={groupedSections}
                notes={visibleNotes}
                onGroupKeyDown={navigation.handleGroupHeaderKeyDown}
                renderCard={(note, flatIndex) => <VaultGalleryCard
                    allNotes={allNotes}
                    cardSize={cardSize}
                    coverField={activeView.coverField ?? ''}
                    coverFitClass={activeView.imageFit === 'cover' ? 'bg-cover' : 'bg-contain'}
                    dynamicColumns={dynamicColumns}
                    flatIndex={flatIndex}
                    idToTitle={idToTitle}
                    isSelected={selection.isSelected(note.id)}
                    key={`${note.id}-${String(flatIndex)}`}
                    localeSettings={localeSettings}
                    note={note}
                    onKeyDown={navigation.handleCardKeyDown}
                    onNoteSelect={onNoteSelect}
                    onOpenParallel={onOpenParallel}
                    onUpdateNote={onUpdateNote}
                    previewMode={previewMode}
                    registerCard={(element) => {
                        navigation.cardRefs.current[flatIndex] = element;
                    }}
                    schema={schema}
                    selectedCount={selection.selectedIds.size}
                    titlePreviewProps={titlePreview.getTitleProps(note.id)}
                    toggleSelect={selection.toggleSelect}
                />}
                toggleGroup={(groupId) => {
                    toggleExpandedGroup(setExpandedGroups, groupId);
                }}
            />
        </div>
        {titlePreview.preview}
    </div>;
}


function toggleExpandedGroup(
    setExpandedGroups: Dispatch<SetStateAction<Set<string>>>,
    groupId: string,
): void {
    setExpandedGroups((current) => {
        const next = new Set(current);
        if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
        return next;
    });
}
