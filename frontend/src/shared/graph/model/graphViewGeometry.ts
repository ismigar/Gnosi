import type Graph from 'graphology';

const MIN_EXTENT = 1;

interface GraphPoint {
  x: number;
  y: number;
}

interface GraphBounds {
  centerX: number;
  centerY: number;
  count?: number;
  height: number;
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
  width: number;
}

interface GraphNodeAttributes {
  [key: string]: unknown;
  hidden?: unknown;
  x?: unknown;
  y?: unknown;
}

interface Dimensions {
  height: number;
  width: number;
}

interface ViewportRenderer {
  getDimensions?: () => Dimensions;
  viewportToGraph(point: GraphPoint): GraphPoint;
}

interface RequiredViewportRenderer extends ViewportRenderer {
  getDimensions(): Dimensions;
}

interface CameraRatioRenderer {
  getCamera?: () => { getState(): { ratio?: unknown } };
  getDimensions?: () => Dimensions;
  getGraphToViewportRatio?: () => unknown;
  normalizationFunction?: { ratio?: unknown };
}

interface MinimapTransform {
  graphToMinimap(x: number, y: number): GraphPoint;
  height: number;
  minimapToGraph(x: number, y: number): GraphPoint;
  scale: number;
  width: number;
}

interface MinimapProjector {
  graphToMinimap(x: number, y: number): GraphPoint;
}

interface ViewportRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

type VisibleGraph = Pick<Graph<GraphNodeAttributes>, 'forEachNode'>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function createBounds(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  count = 0,
): GraphBounds {
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(MIN_EXTENT, maxX - minX),
    height: Math.max(MIN_EXTENT, maxY - minY),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    count,
  };
}

export function getVisibleGraphBounds(
  graph: VisibleGraph | null | undefined,
): GraphBounds | null {
  if (!graph) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;

  graph.forEachNode((_node, attrs) => {
    if (
      attrs.hidden ||
      !isFiniteNumber(attrs.x) ||
      !isFiniteNumber(attrs.y)
    ) {
      return;
    }
    minX = Math.min(minX, attrs.x);
    maxX = Math.max(maxX, attrs.x);
    minY = Math.min(minY, attrs.y);
    maxY = Math.max(maxY, attrs.y);
    count += 1;
  });

  if (count === 0) return null;
  return createBounds(minX, maxX, minY, maxY, count);
}

export function getCameraGraphBounds(
  renderer: ViewportRenderer | null | undefined,
): GraphBounds | null {
  if (!renderer) return null;
  const dimensions = renderer.getDimensions?.();
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return null;
  }

  const corners = [
    renderer.viewportToGraph({ x: 0, y: 0 }),
    renderer.viewportToGraph({ x: dimensions.width, y: 0 }),
    renderer.viewportToGraph({ x: dimensions.width, y: dimensions.height }),
    renderer.viewportToGraph({ x: 0, y: dimensions.height }),
  ];
  if (corners.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    return null;
  }

  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  return createBounds(
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  );
}

export function mergeGraphBounds(
  ...bounds: Array<GraphBounds | null | undefined>
): GraphBounds | null {
  const validBounds = bounds.filter(
    (value): value is GraphBounds => Boolean(value),
  );
  if (validBounds.length === 0) return null;

  return createBounds(
    Math.min(...validBounds.map((value) => value.minX)),
    Math.max(...validBounds.map((value) => value.maxX)),
    Math.min(...validBounds.map((value) => value.minY)),
    Math.max(...validBounds.map((value) => value.maxY)),
    validBounds.reduce((total, value) => total + (value.count || 0), 0),
  );
}

export function createMinimapTransform(
  bounds: GraphBounds | null | undefined,
  width: number,
  height: number,
  padding = 1.1,
): MinimapTransform | null {
  if (!bounds || width <= 0 || height <= 0) return null;

  const scaleX = width / (bounds.width * padding);
  const scaleY = height / (bounds.height * padding);
  const scale = Math.min(scaleX, scaleY);

  return {
    width,
    height,
    scale,
    graphToMinimap(x, y) {
      return {
        x: width / 2 + (x - bounds.centerX) * scale,
        y: height / 2 - (y - bounds.centerY) * scale,
      };
    },
    minimapToGraph(x, y) {
      return {
        x: bounds.centerX + (x - width / 2) / scale,
        y: bounds.centerY - (y - height / 2) / scale,
      };
    },
  };
}

export function getVisibleCameraRatio(
  renderer: CameraRatioRenderer | null | undefined,
  bounds: Pick<GraphBounds, 'width' | 'height'> | null | undefined,
  padding = 1.18,
): number {
  const dimensions = renderer?.getDimensions?.();
  const currentRatio = renderer?.getCamera?.().getState().ratio;
  const graphToViewportRatio = renderer?.getGraphToViewportRatio?.();
  const hasUsableDimensions =
    dimensions !== undefined &&
    dimensions.width > 0 &&
    dimensions.height > 0;
  if (
    bounds &&
    hasUsableDimensions &&
    isFiniteNumber(currentRatio) &&
    isFiniteNumber(graphToViewportRatio) &&
    graphToViewportRatio > 0
  ) {
    const targetGraphToViewportRatio = Math.min(
      dimensions.width / (bounds.width * padding),
      dimensions.height / (bounds.height * padding),
    );
    return Math.max(
      0.02,
      (currentRatio * graphToViewportRatio) / targetGraphToViewportRatio,
    );
  }

  const normalizationRatio = renderer?.normalizationFunction?.ratio;
  if (
    !bounds ||
    !isFiniteNumber(normalizationRatio) ||
    normalizationRatio <= 0
  ) {
    return 1;
  }

  const visibleExtent = Math.max(bounds.width, bounds.height);
  return Math.max(0.02, (visibleExtent / normalizationRatio) * padding);
}

export function getCameraViewportRect(
  renderer: RequiredViewportRenderer | null | undefined,
  transform: MinimapProjector | null | undefined,
): ViewportRect | null {
  if (!renderer || !transform) return null;

  const { width, height } = renderer.getDimensions();
  if (width <= 0 || height <= 0) return null;

  const corners = [
    renderer.viewportToGraph({ x: 0, y: 0 }),
    renderer.viewportToGraph({ x: width, y: 0 }),
    renderer.viewportToGraph({ x: width, y: height }),
    renderer.viewportToGraph({ x: 0, y: height }),
  ].map(({ x, y }) => transform.graphToMinimap(x, y));

  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: Math.max(4, maxX - minX),
    height: Math.max(4, maxY - minY),
  };
}
