const MIN_EXTENT = 1;

export function getVisibleGraphBounds(graph) {
  if (!graph) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;

  graph.forEachNode((_, attrs) => {
    if (attrs.hidden || !Number.isFinite(attrs.x) || !Number.isFinite(attrs.y)) return;
    minX = Math.min(minX, attrs.x);
    maxX = Math.max(maxX, attrs.x);
    minY = Math.min(minY, attrs.y);
    maxY = Math.max(maxY, attrs.y);
    count += 1;
  });

  if (count === 0) return null;

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

export function createMinimapTransform(bounds, width, height, padding = 1.1) {
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

export function getVisibleCameraRatio(renderer, bounds, padding = 1.18) {
  const dimensions = renderer?.getDimensions?.();
  const currentRatio = renderer?.getCamera?.().getState().ratio;
  const graphToViewportRatio = renderer?.getGraphToViewportRatio?.();
  if (
    bounds
    && dimensions?.width > 0
    && dimensions?.height > 0
    && Number.isFinite(currentRatio)
    && Number.isFinite(graphToViewportRatio)
    && graphToViewportRatio > 0
  ) {
    const targetGraphToViewportRatio = Math.min(
      dimensions.width / (bounds.width * padding),
      dimensions.height / (bounds.height * padding),
    );
    return Math.max(
      0.02,
      currentRatio * graphToViewportRatio / targetGraphToViewportRatio,
    );
  }

  const normalizationRatio = renderer?.normalizationFunction?.ratio;
  if (!bounds || !Number.isFinite(normalizationRatio) || normalizationRatio <= 0) {
    return 1;
  }

  const visibleExtent = Math.max(bounds.width, bounds.height);
  return Math.max(0.02, (visibleExtent / normalizationRatio) * padding);
}

export function getCameraViewportRect(renderer, transform) {
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

  if (Number.isFinite(transform.width) && Number.isFinite(transform.height)) {
    const x = Math.max(0, Math.min(transform.width - 4, minX));
    const y = Math.max(0, Math.min(transform.height - 4, minY));
    const right = Math.max(4, Math.min(transform.width, maxX));
    const bottom = Math.max(4, Math.min(transform.height, maxY));

    return {
      x,
      y,
      width: Math.max(4, Math.min(transform.width - x, right - x)),
      height: Math.max(4, Math.min(transform.height - y, bottom - y)),
    };
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(4, maxX - minX),
    height: Math.max(4, maxY - minY),
  };
}
