import type { ChangeEvent, RefObject } from 'react';

import type { EffectiveTheme } from '../../../../shared/hooks/useTheme';


export type IconPickerTab = 'custom' | 'emoji' | 'icons';


export interface IconPickerAnchorRect {
    readonly bottom: number;
    readonly left: number;
    readonly top: number;
}


export interface IconPickerProps {
    readonly anchorRect?: IconPickerAnchorRect | null;
    readonly currentIcon?: string | null;
    readonly isOpen: boolean;
    readonly onClose: () => unknown;
    readonly onSelectIcon: (icon: string) => unknown;
    readonly triggerRef?: RefObject<HTMLElement | null> | null;
}


export interface VaultColor {
    readonly color: string;
    readonly label: string;
    readonly name: string;
}


export interface LucideIconOption {
    readonly displayName: string;
    readonly iconName: import('lucide-react/dynamic').IconName;
}


export interface IconPickerController {
    readonly activeTab: IconPickerTab;
    readonly customIcons: readonly string[];
    readonly effectiveTheme: EffectiveTheme;
    readonly filteredIcons: readonly LucideIconOption[];
    readonly handleFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
    readonly importFromUrl: () => void;
    readonly isImportingLink: boolean;
    readonly isUploading: boolean;
    readonly linkInput: string;
    readonly removeCustomIcon: (icon: string) => void;
    readonly searchTerm: string;
    readonly selectCustomIcon: (icon: string) => void;
    readonly selectEmoji: (emoji: string) => void;
    readonly selectLucideIcon: (icon: LucideIconOption) => void;
    readonly selectedColor: string;
    readonly setActiveTab: (tab: IconPickerTab) => void;
    readonly setLinkInput: (value: string) => void;
    readonly setSearchTerm: (value: string) => void;
    readonly setSelectedColor: (color: string) => void;
}
