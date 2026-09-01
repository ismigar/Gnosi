import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useLocaleSettings } from '../../../shared/i18n/useLocaleSettings';
import { useVaultSelection } from '../../../shared/records/hooks/useVaultSelection';
import { useVaultSelectionShortcuts } from '../../../shared/records/hooks/useVaultSelectionShortcuts';
import {
    useVaultViewData,
    type VaultViewConfig,
} from '../../../shared/records/hooks/useVaultViewData';
import { requireFilterNodes } from '../../../shared/filtering/filterContracts';
import { VaultBulkActionsBar, type BulkActionTemplate } from '../../../shared/record-views/VaultBulkActionsBar';
import { VaultViewToolbar } from '../../../shared/record-views/VaultViewToolbar';
import { getFieldType, getSchemaFieldNames, resolveViewFilters, resolveViewSorts } from '../../../shared/records/model/schemaUtils';
import { useTitlePreview } from '../../../shared/editor/useTitlePreview';
import { isMainView } from './viewConstants';
import { VaultGalleryCard } from './vault-gallery/VaultGalleryCard';
import { VaultGallerySections } from './vault-gallery/VaultGallerySections';
import {
    buildGallerySections,
    galleryCardSize,
    galleryCoverFitClass,
    galleryGroupField,
    galleryPreviewMode,
    galleryVisibleProperties,
    type GalleryNote,
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
    readonly onDeletePage?: (pageId: string, title?: GalleryNote['title']) => void;
    readonly onDeleteSelected?: (selectedIds: Set<string>) => void;
    readonly onEditSchema?: (section: string) => void;
    readonly onExitBottom?: () => void;
    readonly onExitTop?: () => void;
    readonly onFocusShell?: () => void;
    readonly onNoteSelect?: (noteId: string) => void;
    readonly onOpenParallel?: (noteId: string) => void;
    readonly onUpdateNote?: (
        pageId: string,
        patch: { readonly metadata: Record<string, string[]> },
    ) => unknown;
    readonly registerNavApi?: (api: VaultGalleryNavigationApi | null) => void;
    readonly schema?: GallerySchema;
    readonly searchTerm?: string;
    readonly templates?: readonly BulkActionTemplate[];
}


export function VaultGallery(props: VaultGalleryProps) {
    const activeView = props.activeView ?? {};
    const groupBy = galleryGroupField(activeView);
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
        filters: requireFilterNodes(resolveViewFilters(activeView)),
        search: searchTerm,
        sorts: resolveViewSorts(activeView, { direction: 'desc', field: 'last_modified' }),
    }), [activeView, searchTerm]);
    const { sortedPages } = useVaultViewData({ pages: notes, schema, searchTerm, view });
    const visibleNotes = sortedPages;
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

    const configuredProperties = galleryVisibleProperties(activeView.visibleProperties)
        ?? (isMainView(activeView)
            ? getSchemaFieldNames(schema)
            : getSchemaFieldNames(schema).slice(0, 3));
    const dynamicColumns = configuredProperties
        .map((field): readonly [string, string] => [field, getFieldType(schema, field)])
        .filter(([, type]) => Boolean(type) && type !== 'title');
    const cardSize = galleryCardSize(activeView.cardSize);
    const previewMode = galleryPreviewMode(activeView.galleryPreview);

    return <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-primary)]">
        {externalSearchTerm === undefined ? <div className="flex items-center justify-between gap-2">
            <VaultViewToolbar
                activeFiltersCount={resolveViewFilters(activeView).length}
                activeSortsCount={resolveViewSorts(activeView).length}
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
                    coverFitClass={galleryCoverFitClass(activeView.imageFit)}
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
