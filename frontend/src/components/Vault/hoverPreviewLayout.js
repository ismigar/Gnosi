export const HOVER_PREVIEW_MARGIN = 8;
export const HOVER_PREVIEW_ARROW_STEP = 40;

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

export function isHoverPreviewScrollable(element) {
    return Boolean(element && element.scrollHeight > element.clientHeight);
}

export function scrollHoverPreviewByKey(element, key) {
    if (!isHoverPreviewScrollable(element)) return false;

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const pageStep = Math.max(HOVER_PREVIEW_ARROW_STEP, Math.round(element.clientHeight * 0.8));
    let nextScrollTop;

    switch (key) {
        case 'ArrowUp':
            nextScrollTop = element.scrollTop - HOVER_PREVIEW_ARROW_STEP;
            break;
        case 'ArrowDown':
            nextScrollTop = element.scrollTop + HOVER_PREVIEW_ARROW_STEP;
            break;
        case 'PageUp':
            nextScrollTop = element.scrollTop - pageStep;
            break;
        case 'PageDown':
            nextScrollTop = element.scrollTop + pageStep;
            break;
        case 'Home':
            nextScrollTop = 0;
            break;
        case 'End':
            nextScrollTop = maxScrollTop;
            break;
        default:
            return false;
    }

    element.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
    return true;
}
