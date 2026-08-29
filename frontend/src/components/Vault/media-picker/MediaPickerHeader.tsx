import {
    Database,
    Folder,
    Image as ImageIcon,
    Library,
    Search,
    X,
    type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { MediaRoot } from '../../../shared/api/media-browser';


interface MediaPickerHeaderProps {
    readonly activeRoot: string;
    readonly onCancel?: (() => unknown) | null;
    readonly onRootChange: (root: string) => void;
    readonly onSearchChange: (search: string) => void;
    readonly roots: readonly MediaRoot[];
    readonly search: string;
}


const ROOT_ICONS: Readonly<Record<string, LucideIcon>> = {
    assets: Folder,
    images: ImageIcon,
    library: Library,
    vault: Database,
};


export function MediaPickerHeader({
    activeRoot,
    onCancel,
    onRootChange,
    onSearchChange,
    roots,
    search,
}: MediaPickerHeaderProps) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center gap-2 p-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
            {roots.map((root) => {
                const Icon = ROOT_ICONS[root.key] ?? Folder;
                const active = root.key === activeRoot;
                return (
                    <button
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active ? 'bg-[var(--gnosi-primary)] text-white shadow-sm' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-primary)]'}`}
                        key={root.key}
                        onClick={() => {
                            onRootChange(root.key);
                        }}
                        type="button"
                    >
                        <Icon size={14} />
                        {root.label}
                    </button>
                );
            })}
            <div className="flex-1" />
            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={14} />
                <input
                    className="pl-8 pr-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md text-xs w-44 outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]/30"
                    onChange={(event) => {
                        onSearchChange(event.target.value);
                    }}
                    placeholder={t('media_picker.filter_placeholder', 'Filter...')}
                    type="text"
                    value={search}
                />
            </div>
            {onCancel ? (
                <button
                    aria-label={t('common.close', 'Close')}
                    className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
                    onClick={onCancel}
                    type="button"
                >
                    <X size={16} />
                </button>
            ) : null}
        </div>
    );
}
