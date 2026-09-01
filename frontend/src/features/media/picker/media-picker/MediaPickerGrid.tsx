import type { ReactNode } from 'react';
import { File as FileIcon, Folder, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { MediaItem } from '../../../../shared/api/media-browser';
import { MediaKindIcon } from './MediaKindIcon';
import { normalizeMediaUrl } from './model';


interface MediaPickerGridProps {
    readonly activePath: string | null;
    readonly items: readonly MediaItem[];
    readonly loading: boolean;
    readonly onSelect: (item: MediaItem) => unknown;
}


export function MediaPickerGrid({
    activePath,
    items,
    loading,
    onSelect,
}: MediaPickerGridProps) {
    const { t } = useTranslation();
    if (activePath === null) {
        return (
            <EmptyMediaState
                icon={<Folder className="opacity-20" size={48} />}
                message={t(
                    'media_picker.pick_folder_hint',
                    'Choose a folder or «All content»',
                )}
            />
        );
    }
    if (loading) {
        return (
            <EmptyMediaState
                icon={<ImageIcon className="opacity-20 animate-pulse" size={48} />}
                message={t('media_picker.indexing', 'Indexing…')}
            />
        );
    }
    if (!items.length) {
        return (
            <EmptyMediaState
                icon={<FileIcon className="opacity-10" size={48} />}
                message={t('media_picker.no_files', 'No files found')}
            />
        );
    }

    return (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {items.map((item) => (
                <button
                    className="group cursor-pointer bg-[var(--bg-secondary)] rounded-lg overflow-hidden border border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50 hover:shadow-md transition-all text-left"
                    key={`${item.root}::${item.path}`}
                    onClick={() => {
                        onSelect(item);
                    }}
                    title={item.filename}
                    type="button"
                >
                    <div className="aspect-square relative overflow-hidden bg-gray-900 flex items-center justify-center">
                        {item.kind === 'image' ? (
                            <img
                                alt={item.filename}
                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                loading="lazy"
                                onError={(event) => {
                                    event.currentTarget.style.display = 'none';
                                }}
                                src={normalizeMediaUrl(item.url)}
                            />
                        ) : (
                            <MediaKindIcon kind={item.kind} size={36} />
                        )}
                    </div>
                    <div className="p-1.5 flex items-center gap-1 min-w-0">
                        <MediaKindIcon kind={item.kind} size={12} />
                        <span
                            className="text-[10px] text-[var(--text-secondary)] truncate"
                            title={item.filename}
                        >
                            {item.filename}
                        </span>
                    </div>
                </button>
            ))}
        </div>
    );
}


interface EmptyMediaStateProps {
    readonly icon: ReactNode;
    readonly message: string;
}


function EmptyMediaState({ icon, message }: EmptyMediaStateProps) {
    return (
        <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] gap-2">
            {icon}
            <p className="text-xs">{message}</p>
        </div>
    );
}
