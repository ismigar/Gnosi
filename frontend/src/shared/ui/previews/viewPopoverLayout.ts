const VIEWPORT_PADDING = 8;
const POPOVER_GAP = 6;
const PREFERRED_WIDTH = 400;
const PREFERRED_MAX_HEIGHT = 620;
const MIN_USEFUL_HEIGHT = 280;

interface PopoverAnchorRect {
  bottom: number;
  left: number;
  top: number;
}

interface ViewPopoverLayout {
  bottom?: number;
  left: number;
  maxHeight: number;
  top?: number;
  width: number;
}

/** Calculates a viewport-safe position for the view management popover. */
export function getViewPopoverLayout(
  anchorRect: PopoverAnchorRect,
  viewportWidth: number,
  viewportHeight: number,
): ViewPopoverLayout {
  const width = Math.max(
    0,
    Math.min(
      PREFERRED_WIDTH,
      viewportWidth - VIEWPORT_PADDING * 2,
    ),
  );
  const maxLeft = Math.max(
    VIEWPORT_PADDING,
    viewportWidth - width - VIEWPORT_PADDING,
  );
  const left = Math.min(
    Math.max(anchorRect.left, VIEWPORT_PADDING),
    maxLeft,
  );
  const spaceBelow = Math.max(
    0,
    viewportHeight -
      anchorRect.bottom -
      POPOVER_GAP -
      VIEWPORT_PADDING,
  );
  const spaceAbove = Math.max(
    0,
    anchorRect.top - POPOVER_GAP - VIEWPORT_PADDING,
  );
  const openAbove =
    spaceBelow < MIN_USEFUL_HEIGHT && spaceAbove > spaceBelow;
  const maxHeight = Math.min(
    PREFERRED_MAX_HEIGHT,
    openAbove ? spaceAbove : spaceBelow,
  );

  if (openAbove) {
    return {
      left,
      width,
      maxHeight,
      bottom: viewportHeight - anchorRect.top + POPOVER_GAP,
    };
  }

  return {
    left,
    width,
    maxHeight,
    top: anchorRect.bottom + POPOVER_GAP,
  };
}
