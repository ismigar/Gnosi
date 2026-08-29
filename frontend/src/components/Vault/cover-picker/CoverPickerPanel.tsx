import { CoverPickerTabs } from './CoverPickerTabs';
import type { CoverPickerPanelProps } from './types';
import {
    GalleryCoverView,
    LinkCoverView,
    UnsplashCoverView,
    UploadCoverView,
} from './CoverPickerViews';


export function CoverPickerPanel({
    controller,
    currentCover,
    fileInputRef,
    panelRef,
}: CoverPickerPanelProps) {
    return (
        <div
            className="fixed z-[var(--z-popover)] w-96 bg-[var(--bg-primary)] rounded-lg shadow-2xl border border-[var(--border-primary)] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
            onClick={(event) => {
                event.stopPropagation();
            }}
            ref={panelRef}
            style={{ maxHeight: '600px', right: '20px', top: '60px' }}
        >
            <CoverPickerTabs
                activeTab={controller.activeTab}
                currentCover={currentCover}
                onClear={() => {
                    controller.selectCover('');
                }}
                onTabChange={controller.setActiveTab}
            />
            {controller.activeTab === 'gallery' ? (
                <GalleryCoverView controller={controller} />
            ) : null}
            {controller.activeTab === 'upload' ? (
                <UploadCoverView controller={controller} fileInputRef={fileInputRef} />
            ) : null}
            {controller.activeTab === 'link' ? (
                <LinkCoverView controller={controller} />
            ) : null}
            {controller.activeTab === 'unsplash' ? (
                <UnsplashCoverView controller={controller} />
            ) : null}
        </div>
    );
}
