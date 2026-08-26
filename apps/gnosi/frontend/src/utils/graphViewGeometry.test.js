import { describe, expect, it } from 'vitest';
import Graph from 'graphology';

import {
  createMinimapTransform,
  getCameraGraphBounds,
  getCameraViewportRect,
  getVisibleCameraRatio,
  mergeGraphBounds,
} from './graphViewGeometry';

describe('graph view geometry', () => {
  it('round-trips graph coordinates and keeps graph Y pointing upward', () => {
    const bounds = {
      minX: -100,
      maxX: 100,
      minY: -50,
      maxY: 50,
      width: 200,
      height: 100,
      centerX: 0,
      centerY: 0,
    };
    const transform = createMinimapTransform(bounds, 200, 100, 1);

    expect(transform.graphToMinimap(0, 50)).toEqual({ x: 100, y: 0 });
    const point = transform.minimapToGraph(175, 75);
    const roundTrip = transform.graphToMinimap(point.x, point.y);
    expect(roundTrip.x).toBeCloseTo(175);
    expect(roundTrip.y).toBeCloseTo(75);
  });

  it('derives the minimap viewport from Sigma viewport conversions', () => {
    const transform = {
      graphToMinimap: (x, y) => ({ x: x * 2, y: y * 3 }),
    };
    const renderer = {
      getDimensions: () => ({ width: 100, height: 50 }),
      viewportToGraph: ({ x, y }) => ({ x: x / 10, y: y / 10 }),
    };

    expect(getCameraViewportRect(renderer, transform)).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 15,
    });
  });

  it('keeps the complete camera frame inside the minimap transform', () => {
    const renderer = {
      getDimensions: () => ({ width: 100, height: 50 }),
      viewportToGraph: ({ x, y }) => ({ x: x / 2 - 10, y: y / 2 - 5 }),
    };
    const graphBounds = {
      minX: 0,
      maxX: 20,
      minY: 0,
      maxY: 10,
      width: 20,
      height: 10,
      centerX: 10,
      centerY: 5,
      count: 2,
    };
    const cameraBounds = getCameraGraphBounds(renderer);
    const combinedBounds = mergeGraphBounds(graphBounds, cameraBounds);
    const transform = createMinimapTransform(combinedBounds, 200, 100);
    const rect = getCameraViewportRect(renderer, transform);

    expect(rect.x).toBeGreaterThan(0);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.x + rect.width).toBeLessThan(200);
    expect(rect.y + rect.height).toBeLessThan(100);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });

  it('scales camera ratios to the visible subset instead of the full graph', () => {
    const renderer = {
      getDimensions: () => ({ width: 1000, height: 500 }),
      getCamera: () => ({ getState: () => ({ ratio: 0.5 }) }),
      getGraphToViewportRatio: () => 10,
      normalizationFunction: { ratio: 1000 },
    };
    const bounds = { width: 200, height: 100 };

    expect(getVisibleCameraRatio(renderer, bounds, 1.2)).toBeCloseTo(1.2);
  });
});
