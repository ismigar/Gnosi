export const HOVER_PREVIEW_MARGIN = 8;

export function adaptiveHoverPreviewStyle({
    minWidth = 260,
    maxWidth = 420,
    maxHeight = 420,
    margin = HOVER_PREVIEW_MARGIN,
} = {}) {
    const viewportInset = margin * 2;
    return {
        width: 'max-content',
        minWidth: `min(${minWidth}px, calc(100vw - ${viewportInset}px))`,
        maxWidth: `min(${maxWidth}px, calc(100vw - ${viewportInset}px))`,
        maxHeight: `min(${maxHeight}px, calc(100vh - ${viewportInset}px))`,
        overflowX: 'hidden',
    };
}

export function positionHoverPreview(
    anchorRect,
    popupRect,
    viewport,
    margin = HOVER_PREVIEW_MARGIN,
) {
    let top = anchorRect.bottom + margin;
    let left = anchorRect.left;

    if (top + popupRect.height > viewport.height - margin) {
        const above = anchorRect.top - popupRect.height - margin;
        top = above >= margin ? above : margin;
    }
    if (left + popupRect.width > viewport.width - margin) {
        left = Math.max(margin, viewport.width - popupRect.width - margin);
    }
    if (left < margin) left = margin;

    return { top, left };
}
