import { useTranslation } from 'react-i18next';

import type { IconPickerTab } from './types';


interface IconPickerTabsProps {
    readonly activeTab: IconPickerTab;
    readonly currentIcon?: string | null;
    readonly onClear: () => void;
    readonly onTabChange: (tab: IconPickerTab) => void;
}


const tabs: readonly IconPickerTab[] = ['emoji', 'icons', 'custom'];


export function IconPickerTabs({
    activeTab,
    currentIcon,
    onClear,
    onTabChange,
}: IconPickerTabsProps) {
    const { t } = useTranslation();

    return (
        <div className="flex items-center gap-1 font-medium text-xs text-[var(--text-secondary)]/60 border-b border-[var(--border-primary)] px-2 pt-2 bg-[var(--bg-secondary)] shrink-0">
            {tabs.map((tab) => (
                <button
                    className={`px-3 py-1.5 border-b-2 transition-colors ${activeTab === tab ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]' : 'border-transparent hover:text-[var(--text-primary)]'}`}
                    key={tab}
                    onClick={() => {
                        onTabChange(tab);
                    }}
                    type="button"
                >
                    {t(`icon_picker.tabs.${tab}`)}
                </button>
            ))}
            <div className="flex-1" />
            {currentIcon ? (
                <button
                    className="text-[10px] text-[var(--status-error)] hover:text-[var(--status-error)]/80 hover:bg-[var(--status-error)]/10 px-2 py-1 rounded transition-colors mr-1 font-bold"
                    onClick={onClear}
                    type="button"
                >
                    {t('icon_picker.delete_button')}
                </button>
            ) : null}
        </div>
    );
}
