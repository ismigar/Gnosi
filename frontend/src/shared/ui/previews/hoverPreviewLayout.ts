export const HOVER_PREVIEW_MARGIN = 8;
export const HOVER_PREVIEW_ARROW_STEP = 40;

interface AdaptiveHoverPreviewOptions {
  margin?: number;
  maxHeight?: number;
  maxWidth?: number;
  minWidth?: number;
}

interface HoverPreviewStyle {
  maxHeight: string;
  maxWidth: string;
  minWidth: string;
  overflowX: 'hidden';
  width: 'max-content';
}

interface HoverAnchorRect {
  bottom: number;
  left: number;
  top: number;
}

interface HoverPopupRect {
  height: number;
  width: number;
}

interface HoverViewport {
  height: number;
  width: number;
}

interface HoverPosition {
  left: number;
  top: number;
}

interface HoverScrollableElement {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

export function adaptiveHoverPreviewStyle({
  minWidth = 260,
  maxWidth = 420,
  maxHeight = 420,
  margin = HOVER_PREVIEW_MARGIN,
}: AdaptiveHoverPreviewOptions = {}): HoverPreviewStyle {
  const viewportInset = margin * 2;
  return {
    width: 'max-content',
    minWidth: `min(${String(minWidth)}px, calc(100vw - ${String(viewportInset)}px))`,
    maxWidth: `min(${String(maxWidth)}px, calc(100vw - ${String(viewportInset)}px))`,
    maxHeight: `min(${String(maxHeight)}px, calc(100vh - ${String(viewportInset)}px))`,
    overflowX: 'hidden',
  };
}

export function positionHoverPreview(
  anchorRect: HoverAnchorRect,
  popupRect: HoverPopupRect,
  viewport: HoverViewport,
  margin = HOVER_PREVIEW_MARGIN,
): HoverPosition {
  let top = anchorRect.bottom + margin;
  let left = anchorRect.left;

  if (top + popupRect.height > viewport.height - margin) {
    const above = anchorRect.top - popupRect.height - margin;
    top = above >= margin ? above : margin;
  }
  if (left + popupRect.width > viewport.width - margin) {
    left = Math.max(
      margin,
      viewport.width - popupRect.width - margin,
    );
  }
  if (left < margin) left = margin;

  return { top, left };
}

export function isHoverPreviewScrollable(
  element?: HoverScrollableElement | null,
): boolean {
  return Boolean(element && element.scrollHeight > element.clientHeight);
}

export function scrollHoverPreviewByKey(
  element: HoverScrollableElement | null | undefined,
  key: string,
): boolean {
  if (!isHoverPreviewScrollable(element) || !element) return false;

  const maxScrollTop = Math.max(
    0,
    element.scrollHeight - element.clientHeight,
  );
  const pageStep = Math.max(
    HOVER_PREVIEW_ARROW_STEP,
    Math.round(element.clientHeight * 0.8),
  );
  let nextScrollTop: number;

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

  element.scrollTop = Math.max(
    0,
    Math.min(maxScrollTop, nextScrollTop),
  );
  return true;
}
