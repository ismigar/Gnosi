import { useTranslation } from 'react-i18next';

import type { CoverPickerTab } from './types';


interface CoverPickerTabsProps {
    readonly activeTab: CoverPickerTab;
    readonly currentCover?: string | null;
    readonly onClear: () => void;
    readonly onTabChange: (tab: CoverPickerTab) => void;
}


const TABS: readonly { readonly key: CoverPickerTab; readonly label: string }[] = [
    { key: 'gallery', label: 'cover_picker.tabs.gallery' },
    { key: 'upload', label: 'cover_picker.tabs.upload' },
    { key: 'link', label: 'cover_picker.tabs.link' },
    { key: 'unsplash', label: 'cover_picker.tabs.unsplash' },
];


export function CoverPickerTabs({
    activeTab,
    currentCover,
    onClear,
    onTabChange,
}: CoverPickerTabsProps) {
    const { t } = useTranslation();

    return (
        <div className="flex items-center gap-1 font-medium text-sm text-[var(--text-secondary)]/60 border-b border-[var(--border-primary)] px-2 pt-2 bg-[var(--bg-secondary)]/50">
            {TABS.map((tab) => (
                <button
                    className={`px-3 py-1.5 border-b-2 transition-colors ${activeTab === tab.key ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]' : 'border-transparent hover:text-[var(--text-primary)]'}`}
                    key={tab.key}
                    onClick={() => {
                        onTabChange(tab.key);
                    }}
                    type="button"
                >
                    {t(tab.label)}
                </button>
            ))}
            <div className="flex-1" />
            {currentCover ? (
                <button
                    className="text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 px-2 py-1 rounded transition-colors mr-1"
                    onClick={onClear}
                    type="button"
                >
                    {t('cover_picker.delete_button')}
                </button>
            ) : null}
        </div>
    );
}
