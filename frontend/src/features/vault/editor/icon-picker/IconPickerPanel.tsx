import type { Ref, RefObject } from 'react';

import { CustomIconView } from './CustomIconView';
import { EmojiIconView } from './EmojiIconView';
import { IconPickerTabs } from './IconPickerTabs';
import { LucideIconView } from './LucideIconView';
import type { IconPickerController } from './types';


interface IconPickerPanelProps {
    readonly controller: IconPickerController;
    readonly currentIcon?: string | null;
    readonly fileInputRef: RefObject<HTMLInputElement | null>;
    readonly panelRef: Ref<HTMLDivElement>;
}


export function IconPickerPanel({
    controller,
    currentIcon,
    fileInputRef,
    panelRef,
}: IconPickerPanelProps) {
    return (
        <div
            className="fixed z-[var(--z-popover)] w-[350px] bg-[var(--bg-primary)] rounded-lg shadow-2xl border border-[var(--border-primary)] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
            onClick={(event) => {
                event.stopPropagation();
            }}
            ref={panelRef}
            style={{ left: '48px', maxHeight: '500px', top: '0px' }}
        >
            <IconPickerTabs
                activeTab={controller.activeTab}
                currentIcon={currentIcon}
                onClear={() => {
                    controller.selectCustomIcon('');
                }}
                onTabChange={controller.setActiveTab}
            />
            <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
                {controller.activeTab === 'emoji' ? (
                    <EmojiIconView
                        effectiveTheme={controller.effectiveTheme}
                        onSelect={controller.selectEmoji}
                    />
                ) : null}
                {controller.activeTab === 'icons' ? (
                    <LucideIconView
                        icons={controller.filteredIcons}
                        onColorChange={controller.setSelectedColor}
                        onSearchChange={controller.setSearchTerm}
                        onSelect={controller.selectLucideIcon}
                        searchTerm={controller.searchTerm}
                        selectedColor={controller.selectedColor}
                    />
                ) : null}
                {controller.activeTab === 'custom' ? (
                    <CustomIconView
                        customIcons={controller.customIcons}
                        fileInputRef={fileInputRef}
                        isImportingLink={controller.isImportingLink}
                        isUploading={controller.isUploading}
                        linkInput={controller.linkInput}
                        onFileUpload={controller.handleFileUpload}
                        onImport={controller.importFromUrl}
                        onLinkInputChange={controller.setLinkInput}
                        onRemove={controller.removeCustomIcon}
                        onSelect={controller.selectCustomIcon}
                    />
                ) : null}
            </div>
        </div>
    );
}
