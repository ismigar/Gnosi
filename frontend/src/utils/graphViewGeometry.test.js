import { describe, expect, it } from 'vitest';
import Graph from 'graphology';

import {
  arrangeVisibleIsolatedNodes,
  createMinimapTransform,
  getCameraViewportRect,
  getVisibleCameraRatio,
  getVisibleGraphBounds,
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

  it('clips an overview viewport to the minimap frame', () => {
    const transform = {
      width: 20,
      height: 10,
      graphToMinimap: (x, y) => ({ x, y }),
    };
    const renderer = {
      getDimensions: () => ({ width: 100, height: 50 }),
      viewportToGraph: ({ x, y }) => ({ x: x / 2 - 10, y: y / 2 - 5 }),
    };

    expect(getCameraViewportRect(renderer, transform)).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 10,
    });
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

  it('moves visible isolates into a deterministic ring around visible links', () => {
    const graph = new Graph();
    graph.addNode('a', { x: -10, y: 0 });
    graph.addNode('b', { x: 10, y: 0 });
    graph.addNode('isolated', { x: 9000, y: 9000 });
    graph.addNode('hidden', { x: -8000, y: -8000, hidden: true });
    graph.addEdge('a', 'b');

    expect(arrangeVisibleIsolatedNodes(graph)).toBe(true);
    expect(graph.getNodeAttribute('isolated', 'x')).toBeCloseTo(0);
    expect(graph.getNodeAttribute('isolated', 'y')).toBeCloseTo(-123.5);

    const bounds = getVisibleGraphBounds(graph);
    expect(bounds.count).toBe(3);
    expect(bounds.maxX).toBe(10);
    expect(bounds.minY).toBeCloseTo(-123.5);
  });
});
