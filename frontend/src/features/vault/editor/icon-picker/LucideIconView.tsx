import { Search } from 'lucide-react';
import { DynamicIcon } from 'lucide-react/dynamic';
import { useTranslation } from 'react-i18next';

import { findVaultColor, VAULT_COLORS } from './model';
import type { LucideIconOption } from './types';


interface LucideIconViewProps {
    readonly icons: readonly LucideIconOption[];
    readonly onColorChange: (color: string) => void;
    readonly onSearchChange: (value: string) => void;
    readonly onSelect: (icon: LucideIconOption) => void;
    readonly searchTerm: string;
    readonly selectedColor: string;
}


export function LucideIconView({
    icons,
    onColorChange,
    onSearchChange,
    onSelect,
    searchTerm,
    selectedColor,
}: LucideIconViewProps) {
    const { t } = useTranslation();
    const iconColor = findVaultColor(selectedColor)?.color;

    return (
        <div className="flex flex-col h-[400px]">
            <div className="p-2 border-b border-[var(--border-primary)] flex flex-col gap-2 shrink-0">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]/60" size={14} />
                    <input
                        autoFocus
                        className="w-full pl-8 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-xs outline-none focus:border-[var(--gnosi-primary)] transition-all text-[var(--text-primary)] shadow-sm"
                        onChange={(event) => {
                            onSearchChange(event.target.value);
                        }}
                        placeholder={t('icon_picker.search_placeholder')}
                        value={searchTerm}
                    />
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center py-1">
                    {VAULT_COLORS.map((color) => (
                        <button
                            className={`w-5 h-5 rounded-full border-2 transition-all ${selectedColor === color.name ? 'border-[var(--gnosi-primary)] scale-110' : 'border-transparent hover:scale-105'}`}
                            key={color.name}
                            onClick={() => {
                                onColorChange(color.name);
                            }}
                            style={{ backgroundColor: color.color }}
                            title={color.label}
                            type="button"
                        />
                    ))}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
                <div className="grid grid-cols-6 gap-1">
                    {icons.map((icon) => (
                        <button
                            className="aspect-square flex items-center justify-center rounded hover:bg-[var(--bg-secondary)] transition-colors text-[var(--text-secondary)] p-2"
                            key={icon.displayName}
                            onClick={() => {
                                onSelect(icon);
                            }}
                            title={icon.displayName}
                            type="button"
                        >
                            <DynamicIcon
                                color={iconColor}
                                name={icon.iconName}
                                size={20}
                            />
                        </button>
                    ))}
                </div>
                {icons.length === 0 ? (
                    <div className="text-center text-[var(--text-tertiary)]/60 text-xs py-10">
                        {t('icon_picker.no_icons')}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
