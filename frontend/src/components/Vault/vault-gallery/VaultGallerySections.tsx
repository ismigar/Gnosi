import type {
    KeyboardEvent,
    RefObject,
    ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    galleryGridClass,
    type GalleryCardSize,
    type GalleryNote,
    type GallerySection,
} from './vaultGalleryModel';


interface VaultGallerySectionsProps {
    readonly cardSize: GalleryCardSize;
    readonly expandedGroups: ReadonlySet<string>;
    readonly groupHeaderRefs: RefObject<(HTMLButtonElement | null)[]>;
    readonly groupedSections: readonly GallerySection[] | null;
    readonly notes: readonly GalleryNote[];
    readonly onGroupKeyDown: (
        event: KeyboardEvent<HTMLButtonElement>,
        index: number,
        groupId: string,
    ) => void;
    readonly renderCard: (note: GalleryNote, flatIndex: number) => ReactNode;
    readonly toggleGroup: (groupId: string) => void;
}


export function VaultGallerySections({
    cardSize,
    expandedGroups,
    groupHeaderRefs,
    groupedSections,
    notes,
    onGroupKeyDown,
    renderCard,
    toggleGroup,
}: VaultGallerySectionsProps) {
    const { t } = useTranslation();
    let flatIndex = 0;
    return <div className="mx-auto max-w-[1400px]">
        {groupedSections ? groupedSections.map((section, headerIndex) => {
            const expanded = expandedGroups.has(section.id);
            const firstCardIndex = flatIndex;
            if (expanded) flatIndex += section.notes.length;
            return <section key={section.id} className="mb-8">
                <div className="sticky top-0 z-10 mb-3 flex items-center gap-2 bg-[var(--bg-secondary)] py-1">
                    <button
                        className="flex items-center gap-2 rounded px-1 text-left outline-none transition-opacity hover:opacity-80 focus-visible:ring-1 focus-visible:ring-[var(--gnosi-primary)]"
                        onClick={() => {
                            toggleGroup(section.id);
                        }}
                        onKeyDown={(event) => {
                            onGroupKeyDown(event, headerIndex, section.id);
                        }}
                        ref={(element) => {
                            groupHeaderRefs.current[headerIndex] = element;
                        }}
                        tabIndex={-1}
                        title={expanded
                            ? t('common.collapse', { defaultValue: 'Collapse' })
                            : t('common.expand', { defaultValue: 'Expand' })}
                        type="button"
                    >
                        {expanded
                            ? <ChevronDown className="shrink-0 text-[var(--text-tertiary)]" size={15} />
                            : <ChevronRight className="shrink-0 text-[var(--text-tertiary)]" size={15} />}
                        {section.color ? <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: section.color }}
                        /> : null}
                        <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                            {section.name}
                        </h3>
                        <span className="tabular-nums text-xs text-[var(--text-tertiary)]">
                            {section.notes.length}
                        </span>
                    </button>
                </div>
                {expanded ? <div className={`grid gap-6 ${galleryGridClass(cardSize)}`}>
                    {section.notes.map((note, index) => renderCard(
                        note,
                        firstCardIndex + index,
                    ))}
                </div> : null}
            </section>;
        }) : <div className={`grid gap-6 ${galleryGridClass(cardSize)}`}>
            {notes.map(renderCard)}
        </div>}
        {notes.length === 0 ? <div className="flex h-64 w-full flex-col items-center justify-center text-[var(--text-tertiary)]">
            <FileText className="mb-4 text-[var(--bg-tertiary)]" size={48} strokeWidth={1} />
            <p>{t('view.no_records_in_view', {
                defaultValue: 'No records in this view.',
            })}</p>
        </div> : null}
    </div>;
}
