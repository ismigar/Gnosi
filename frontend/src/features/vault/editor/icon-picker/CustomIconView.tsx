import { Loader2, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent, RefObject } from 'react';

import { withActiveVault } from '../../../../shared/resources/fileResource';
import { VaultAssetImage } from '../../../../shared/ui/previews/VaultAssetImage';


interface CustomIconViewProps {
    readonly customIcons: readonly string[];
    readonly fileInputRef: RefObject<HTMLInputElement | null>;
    readonly isImportingLink: boolean;
    readonly isUploading: boolean;
    readonly linkInput: string;
    readonly onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
    readonly onImport: () => void;
    readonly onLinkInputChange: (value: string) => void;
    readonly onRemove: (icon: string) => void;
    readonly onSelect: (icon: string) => void;
}


export function CustomIconView({
    customIcons,
    fileInputRef,
    isImportingLink,
    isUploading,
    linkInput,
    onFileUpload,
    onImport,
    onLinkInputChange,
    onRemove,
    onSelect,
}: CustomIconViewProps) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-6">
            {customIcons.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-[var(--text-tertiary)]/60 uppercase tracking-widest">
                        {t('icon_picker.recent_section')}
                    </span>
                    <div className="grid grid-cols-6 gap-2">
                        {customIcons.map((icon) => (
                            <button
                                className="relative group aspect-square border border-[var(--border-primary)] rounded-md overflow-hidden bg-[var(--bg-secondary)] hover:border-[var(--gnosi-primary)] transition-colors"
                                key={icon}
                                onClick={() => {
                                    onSelect(icon);
                                }}
                                title={icon}
                                type="button"
                            >
                                <VaultAssetImage
                                    alt={t('icon_picker.custom_icon_alt')}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    src={withActiveVault(icon)}
                                />
                                <span
                                    className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-black/60 text-white cursor-pointer"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onRemove(icon);
                                    }}
                                    title={t('icon_picker.remove_recent_title')}
                                >
                                    <X size={10} />
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-[var(--text-tertiary)]/60 uppercase tracking-widest">
                    {t('icon_picker.upload_section')}
                </span>
                <input
                    accept="image/*"
                    className="hidden"
                    onChange={onFileUpload}
                    ref={fileInputRef}
                    type="file"
                />
                <button
                    className="w-full border border-dashed border-[var(--border-primary)] hover:border-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/5 rounded-lg py-6 flex flex-col items-center gap-2 transition-all"
                    disabled={isUploading}
                    onClick={() => {
                        fileInputRef.current?.click();
                    }}
                    type="button"
                >
                    {isUploading
                        ? <Loader2 className="animate-spin text-[var(--gnosi-primary)]" size={24} />
                        : <Upload className="text-[var(--text-tertiary)]/60" size={24} />}
                    <span className="text-xs text-[var(--text-secondary)]/60">
                        {isUploading
                            ? t('icon_picker.uploading')
                            : t('icon_picker.upload_instruction')}
                    </span>
                </button>
            </div>

            <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-[var(--text-tertiary)]/60 uppercase tracking-widest">
                    {t('icon_picker.link_section')}
                </span>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <input
                            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--gnosi-primary)] transition-all text-[var(--text-primary)]"
                            onChange={(event) => {
                                onLinkInputChange(event.target.value);
                            }}
                            placeholder="https://..."
                            value={linkInput}
                        />
                    </div>
                    <button
                        className="bg-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/90 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors shadow-sm"
                        disabled={isImportingLink}
                        onClick={onImport}
                        type="button"
                    >
                        {isImportingLink
                            ? t('icon_picker.importing')
                            : t('icon_picker.import_button')}
                    </button>
                </div>
            </div>
        </div>
    );
}
