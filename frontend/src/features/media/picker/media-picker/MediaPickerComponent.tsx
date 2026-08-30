import { MediaPickerGrid } from './MediaPickerGrid';
import { MediaPickerHeader } from './MediaPickerHeader';
import { MediaPickerSidebar } from './MediaPickerSidebar';
import type { MediaPickerProps } from './types';
import { useMediaPickerController } from './useMediaPickerController';


export function MediaPickerComponent({
    kindFilter = null,
    onCancel,
    onSelect,
}: MediaPickerProps) {
    const controller = useMediaPickerController(kindFilter);
    return (
        <div className="flex flex-col h-full bg-[var(--bg-primary)] rounded-2xl overflow-hidden border border-[var(--border-primary)]">
            <MediaPickerHeader
                activeRoot={controller.activeRoot}
                onCancel={onCancel}
                onRootChange={controller.selectRoot}
                onSearchChange={controller.setSearch}
                roots={controller.roots}
                search={controller.search}
            />
            <div className="flex flex-1 min-h-0">
                <MediaPickerSidebar
                    activePath={controller.activePath}
                    activeRoot={controller.activeRoot}
                    onSelectPath={controller.selectPath}
                    tree={controller.tree}
                />
                <div className="flex-1 overflow-y-auto p-3">
                    <MediaPickerGrid
                        activePath={controller.activePath}
                        items={controller.filteredItems}
                        loading={controller.loading}
                        onSelect={onSelect}
                    />
                </div>
            </div>
        </div>
    );
}
