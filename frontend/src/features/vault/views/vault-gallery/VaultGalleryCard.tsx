import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { LocaleFormatSettings } from '../../../../shared/i18n/useLocaleSettings';
import { getImageSrc, toAssetPreviewUrl, withActiveVault } from '../../../../shared/resources/fileResource';
import { GalleryContentPreview, GalleryOpenButton } from '../GalleryCardPreview';
import { IconRenderer } from '../../../../shared/ui/previews/IconRenderer';
import type { TitlePreviewTriggerProps } from '../../../../shared/editor/useTitlePreview';
import {
    galleryCardHeightClass,
    galleryCoverHeightClass,
    galleryMetadataValue,
    type GalleryCardSize,
    type GalleryNote,
    type GalleryPreviewMode,
    type GallerySchema,
} from './vaultGalleryModel';
import { VaultGalleryPropertyValue } from './VaultGalleryPropertyValue';


interface VaultGalleryCardProps {
    readonly allNotes: readonly GalleryNote[];
    readonly cardSize: GalleryCardSize;
    readonly coverField: unknown;
    readonly coverFitClass: string;
    readonly dynamicColumns: readonly (readonly [string, string])[];
    readonly flatIndex: number;
    readonly idToTitle: Readonly<Record<string, string>>;
    readonly isSelected: boolean;
    readonly localeSettings: LocaleFormatSettings;
    readonly note: GalleryNote;
    readonly onKeyDown: (
        event: KeyboardEvent<HTMLDivElement>,
        flatIndex: number,
        noteId: string,
    ) => void;
    readonly onNoteSelect?: (noteId: string) => void;
    readonly onOpenParallel?: (noteId: string) => void;
    readonly onUpdateNote?: (
        pageId: string,
        patch: { readonly metadata: Record<string, string[]> },
    ) => unknown;
    readonly previewMode: GalleryPreviewMode;
    readonly registerCard: (element: HTMLDivElement | null) => void;
    readonly schema: GallerySchema;
    readonly selectedCount: number;
    readonly titlePreviewProps: TitlePreviewTriggerProps;
    readonly toggleSelect: (
        noteId: string,
        eventOrShift?: boolean | { readonly shiftKey?: boolean },
    ) => void;
}


function resolveCoverUrl(note: GalleryNote, coverField: unknown): string {
    if (coverField) {
        return toAssetPreviewUrl(getImageSrc(galleryMetadataValue(note, coverField))) || '';
    }
    const cover = note.metadata?.cover;
    if (typeof cover !== 'string' || !cover) return '';
    return cover.startsWith('Assets/')
        ? withActiveVault(`/api/vault/assets/${cover.slice(7)}`)
        : withActiveVault(cover);
}


export function VaultGalleryCard({
    allNotes,
    cardSize,
    coverField,
    coverFitClass,
    dynamicColumns,
    flatIndex,
    idToTitle,
    isSelected,
    localeSettings,
    note,
    onKeyDown,
    onNoteSelect,
    onOpenParallel,
    onUpdateNote,
    previewMode,
    registerCard,
    schema,
    selectedCount,
    titlePreviewProps,
    toggleSelect,
}: VaultGalleryCardProps) {
    const { t } = useTranslation();
    const coverUrl = resolveCoverUrl(note, coverField);
    const showCover = previewMode === 'cover';
    const showContent = previewMode === 'content';
    const showProperties = previewMode === 'cover' || previewMode === 'properties';
    const embeddedPreview = showContent || showProperties;
    return (
        <div
            style={showProperties ? { minHeight: showCover ? (cardSize === 'small' ? '13rem' : cardSize === 'large' ? '21rem' : '17rem') : '9rem' } : undefined}
            className={`group relative flex flex-col overflow-hidden rounded-xl border bg-[var(--bg-primary)] shadow-sm outline-none transition-all hover:shadow-md focus:border-[var(--gnosi-primary)] focus:ring-2 focus:ring-[var(--gnosi-primary)] ${embeddedPreview ? galleryCardHeightClass(cardSize) : ''} ${isSelected ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50'}`}
            onClick={() => {
                if (selectedCount > 0) toggleSelect(note.id);
                else onNoteSelect?.(note.id);
            }}
            onKeyDown={(event) => {
                onKeyDown(event, flatIndex, note.id);
            }}
            ref={registerCard}
            tabIndex={-1}
        >
            {embeddedPreview ? <GalleryOpenButton pageId={note.id} /> : null}
            <label
                className={`absolute left-2 top-2 z-20 cursor-pointer ${isSelected || selectedCount > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                onClick={(event) => {
                    event.stopPropagation();
                }}
            >
                <input
                    checked={isSelected}
                    className="h-4 w-4 cursor-pointer rounded border-[var(--border-primary)] bg-[var(--bg-secondary)]/90 text-[var(--gnosi-primary)] shadow-sm"
                    onChange={() => {
                        toggleSelect(note.id, false);
                    }}
                    type="checkbox"
                />
            </label>
            {showCover ? <div className={`${galleryCoverHeightClass(cardSize)} relative shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]`}>
                {coverUrl ? <div
                    className={`absolute inset-0 bg-center bg-no-repeat ${coverFitClass}`}
                    style={{ backgroundImage: `url("${coverUrl}")` }}
                /> : <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-tertiary)] to-[var(--gnosi-primary)]/10" />}
                <div className="absolute -bottom-5 left-4 z-10 flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-sm transition-transform group-hover:scale-110">
                    <IconRenderer
                        icon={typeof note.metadata?.icon === 'string'
                            ? note.metadata.icon
                            : undefined}
                        size={24}
                    />
                </div>
            </div> : null}
            <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden p-4 ${showCover ? 'pt-6' : ''}`} style={showProperties ? { minHeight: '9rem' } : undefined}>
                <h3
                    className={`mb-2 flex items-center gap-2 truncate text-sm font-semibold text-[var(--text-primary)] transition-colors group-hover:text-[var(--gnosi-primary)] ${embeddedPreview && !showCover ? 'pr-8' : ''}`}
                    title={note.title == null || typeof note.title === 'boolean'
                        ? undefined : String(note.title)}
                >
                    {!showCover ? <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                        <IconRenderer
                            icon={typeof note.metadata?.icon === 'string'
                                ? note.metadata.icon
                                : undefined}
                            size={18}
                        />
                    </span> : null}
                    <span className="truncate" {...titlePreviewProps}>
                        {note.title || t('common.untitled', { defaultValue: 'Untitled' })}
                    </span>
                </h3>
                {showContent ? <div className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden">
                    <GalleryContentPreview
                        idToTitle={{ ...idToTitle }}
                        note={note}
                        onNoteSelect={(pageId) => {
                            if (pageId) onNoteSelect?.(pageId);
                        }}
                        onOpenParallel={onOpenParallel}
                    />
                </div> : null}
                {showProperties ? <div
                    className="custom-scrollbar flex min-w-0 flex-1 cursor-auto flex-col gap-1.5 overflow-y-auto overflow-x-hidden overscroll-contain pr-1"
                    onClick={(event) => {
                        event.stopPropagation();
                    }}
                >
                    {dynamicColumns.map(([field, type]) => {
                        const value = galleryMetadataValue(note, field);
                        if (value === undefined || value === null || value === '') return null;
                        const metadataKey = Object.keys(note.metadata ?? {}).find((key) => (
                            note.metadata?.[key] === value
                        )) ?? field;
                        return <div
                            key={field}
                            className="flex min-h-[18px] items-center gap-2 overflow-hidden text-[var(--text-secondary)]"
                        >
                            <span className="w-16 shrink-0 truncate text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                                {field}
                            </span>
                            <div className="min-w-0 flex-1">
                                <VaultGalleryPropertyValue
                                    allNotes={allNotes}
                                    field={field}
                                    idToTitle={idToTitle}
                                    localeSettings={localeSettings}
                                    metadataKey={metadataKey}
                                    note={note}
                                    onNoteSelect={onNoteSelect}
                                    onUpdateNote={onUpdateNote}
                                    schema={schema}
                                    type={type}
                                    value={value}
                                />
                            </div>
                        </div>;
                    })}
                </div> : null}
            </div>
        </div>
    );
}
