import type { KeyboardEvent, RefObject } from 'react';
import { Image as ImageIcon, Loader2, Search, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PREDEFINED_COVER_GROUPS } from './model';
import type { CoverPickerController } from './types';


interface CoverViewProps {
    readonly controller: CoverPickerController;
}


export function GalleryCoverView({ controller }: CoverViewProps) {
    const { t } = useTranslation();
    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4 max-h-[400px]">
            {PREDEFINED_COVER_GROUPS.map((group) => (
                <div key={group.name}>
                    <div className="text-xs font-semibold text-[var(--text-secondary)]/60 mb-2 uppercase tracking-wider">
                        {t(group.labelKey)}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {group.images.map((image) => (
                            <div
                                className="h-16 rounded cursor-pointer border border-transparent hover:border-[var(--gnosi-primary)] hover:shadow-md transition-all relative overflow-hidden group bg-[var(--bg-secondary)]"
                                key={image}
                                onClick={() => {
                                    controller.selectCover(image);
                                }}
                            >
                                <img alt="cover option" className="w-full h-full object-cover" loading="lazy" src={image} />
                                <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}


interface UploadCoverViewProps extends CoverViewProps {
    readonly fileInputRef: RefObject<HTMLInputElement | null>;
}


export function UploadCoverView({
    controller,
    fileInputRef,
}: UploadCoverViewProps) {
    const { t } = useTranslation();
    return (
        <div className="p-4 flex flex-col gap-4 text-center">
            <p className="text-xs text-[var(--text-secondary)]/60 mb-2">
                {t('cover_picker.upload_instruction')}
            </p>
            <input
                accept="image/*"
                className="hidden"
                onChange={controller.handleFileUpload}
                ref={fileInputRef}
                type="file"
            />
            <button
                className="mx-auto w-full max-w-[200px] border border-[var(--border-primary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] bg-[var(--bg-primary)] shadow-sm flex items-center justify-center gap-2 py-2 rounded-md font-bold text-sm transition-all text-[var(--text-secondary)]"
                disabled={controller.isUploading}
                onClick={() => {
                    fileInputRef.current?.click();
                }}
                type="button"
            >
                {controller.isUploading
                    ? <Loader2 className="animate-spin" size={16} />
                    : <Upload size={16} />}
                {controller.isUploading
                    ? t('cover_picker.uploading')
                    : t('cover_picker.choose_image')}
            </button>
        </div>
    );
}


export function LinkCoverView({ controller }: CoverViewProps) {
    const { t } = useTranslation();
    const applyOnEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'Enter') controller.applyLink();
    };

    return (
        <div className="p-4 flex flex-col gap-3">
            <p className="text-xs text-[var(--text-secondary)]/60">
                {t('cover_picker.link_instruction')}
            </p>
            <div className="flex gap-2">
                <input
                    autoFocus
                    className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--gnosi-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)]/20 transition-all text-[var(--text-primary)]"
                    onChange={(event) => {
                        controller.setLinkInput(event.target.value);
                    }}
                    onKeyDown={applyOnEnter}
                    placeholder="https://..."
                    value={controller.linkInput}
                />
                <button
                    className="bg-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/90 text-white px-3 py-1.5 rounded text-sm font-bold transition-colors shadow-sm"
                    onClick={controller.applyLink}
                    type="button"
                >
                    {t('cover_picker.apply_button')}
                </button>
            </div>
        </div>
    );
}


export function UnsplashCoverView({ controller }: CoverViewProps) {
    const { t } = useTranslation();
    const hasQuery = Boolean(controller.unsplashQuery.trim());
    return (
        <div className="flex flex-col h-[400px]">
            <div className="p-3 border-b border-[var(--border-primary)] shadow-sm relative z-10">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]/60" size={16} />
                    <input
                        autoFocus
                        className="w-full pl-9 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-sm outline-none focus:border-[var(--gnosi-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)]/20 transition-all text-[var(--text-primary)]"
                        onChange={(event) => {
                            controller.setUnsplashQuery(event.target.value);
                        }}
                        placeholder={t('cover_picker.search_placeholder')}
                        value={controller.unsplashQuery}
                    />
                    {controller.isSearching ? (
                        <Loader2 className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-[var(--gnosi-primary)]" size={14} />
                    ) : null}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 relative bg-[var(--bg-secondary)]/30">
                {!controller.unsplashResults.length && !controller.isSearching && hasQuery ? (
                    <div className="text-center text-[var(--text-secondary)]/60 text-sm py-4">
                        {t('cover_picker.no_results')}
                    </div>
                ) : null}
                {!controller.unsplashResults.length && !hasQuery ? (
                    <div className="text-center text-[var(--text-tertiary)]/60 text-sm py-8 flex flex-col items-center gap-2">
                        <ImageIcon className="opacity-50" size={32} />
                        <span>{t('cover_picker.unsplash_instruction')}</span>
                    </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                    {controller.unsplashResults.map((image) => (
                        <div
                            className="h-20 rounded cursor-pointer border border-transparent hover:border-[var(--gnosi-primary)] hover:shadow-md transition-all relative overflow-hidden group bg-[var(--bg-secondary)]"
                            key={image.id}
                            onClick={() => {
                                controller.selectCover(image.url);
                            }}
                        >
                            <img alt="unsplash result" className="w-full h-full object-cover" loading="lazy" src={image.thumb} />
                            <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <a
                                className="absolute bottom-1 left-1 opacity-0 group-hover:opacity-100 text-[9px] text-white/90 truncate w-[90%] hover:underline drop-shadow-md"
                                href={image.author_url}
                                onClick={(event) => {
                                    event.stopPropagation();
                                }}
                                rel="noreferrer"
                                target="_blank"
                            >
                                {image.author}
                            </a>
                        </div>
                    ))}
                </div>
            </div>
            <div className="p-2 text-center text-[10px] text-[var(--text-tertiary)]/60 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)]">
                {t('cover_picker.unsplash_footer')}
            </div>
        </div>
    );
}
