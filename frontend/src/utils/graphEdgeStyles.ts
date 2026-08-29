export const BASE_EDGE_THICKNESS = 0.48;
export const MIN_EDGE_THICKNESS = 0.2;

interface HoverEdgeStyleOptions {
  isHovered: boolean;
  isDark: boolean;
  multiplier?: unknown;
}

interface HoverEdgeStyle {
  color: string;
  opacity: number;
  size: number;
  zIndex: number;
}

export function getRenderedEdgeThickness(multiplier: unknown = 1): number {
  const numericMultiplier = Number(multiplier);
  const normalizedMultiplier =
    Number.isFinite(numericMultiplier) && numericMultiplier > 0
      ? numericMultiplier
      : 1;
  return Math.max(
    MIN_EDGE_THICKNESS,
    BASE_EDGE_THICKNESS * normalizedMultiplier,
  );
}

export function getHoverEdgeStyle({
  isHovered,
  isDark,
  multiplier,
}: HoverEdgeStyleOptions): HoverEdgeStyle {
  const baseSize = getRenderedEdgeThickness(multiplier);

  if (isHovered) {
    return {
      color: isDark
        ? 'rgba(226, 232, 240, 0.72)'
        : 'rgba(71, 85, 105, 0.58)',
      opacity: 1,
      size: Math.max(baseSize, 0.65),
      zIndex: 10,
    };
  }

  return {
    color: isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)',
    opacity: 0.08,
    size: baseSize,
    zIndex: 0,
  };
}
