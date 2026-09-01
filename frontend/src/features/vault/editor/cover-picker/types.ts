import type { ChangeEvent, Ref, RefObject } from 'react';

import type { UnsplashCoverSearch } from '../../../../shared/api/vault-icons';


export type CoverPickerTab = 'gallery' | 'link' | 'unsplash' | 'upload';
export type UnsplashCover = UnsplashCoverSearch['results'][number];


export interface CoverPickerProps {
    readonly currentCover?: string | null;
    readonly isOpen: boolean;
    readonly onClose: () => unknown;
    readonly onSelectCover: (cover: string) => unknown;
    readonly triggerRef: RefObject<HTMLElement | null>;
}


export interface CoverGroup {
    readonly images: readonly string[];
    readonly labelKey: string;
    readonly name: string;
}


export interface CoverPickerController {
    readonly activeTab: CoverPickerTab;
    readonly applyLink: () => void;
    readonly handleFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
    readonly isSearching: boolean;
    readonly isUploading: boolean;
    readonly linkInput: string;
    readonly selectCover: (cover: string) => void;
    readonly setActiveTab: (tab: CoverPickerTab) => void;
    readonly setLinkInput: (value: string) => void;
    readonly setUnsplashQuery: (value: string) => void;
    readonly unsplashQuery: string;
    readonly unsplashResults: readonly UnsplashCover[];
}


export interface CoverPickerPanelProps {
    readonly controller: CoverPickerController;
    readonly currentCover?: string | null;
    readonly fileInputRef: RefObject<HTMLInputElement | null>;
    readonly panelRef: Ref<HTMLDivElement>;
}
