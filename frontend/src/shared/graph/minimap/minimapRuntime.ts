import type Graph from 'graphology';
import type Sigma from 'sigma';

import {
    createMinimapTransform,
    getVisibleCameraRatio,
} from '../model/graphViewGeometry';

export interface GraphPoint {
    readonly x: number;
    readonly y: number;
}

export interface MinimapNodeAttributes {
    readonly [key: string]: unknown;
    readonly hidden?: boolean;
    readonly x: number;
    readonly y: number;
}

export type MinimapGraph = Graph<MinimapNodeAttributes>;
export type MinimapRenderer = Pick<Sigma<MinimapNodeAttributes>,
    'getCamera' | 'getGraph' | 'getDimensions' | 'getGraphToViewportRatio' |
    'viewportToGraph'> & {
    on(event: 'afterRender', listener: () => void): void;
    off(event: 'afterRender', listener: () => void): void;
};
export type MinimapTransform = NonNullable<
    ReturnType<typeof createMinimapTransform>
>;

interface NormalizationFunction {
    (point: GraphPoint): GraphPoint;
    ratio?: unknown;
}

interface SigmaRuntimeAccess {
    readonly killed?: unknown;
    readonly normalizationFunction?: unknown;
}

function sigmaRuntime(renderer: MinimapRenderer): SigmaRuntimeAccess {
    return renderer as unknown as SigmaRuntimeAccess;
}

function isNormalizationFunction(value: unknown): value is NormalizationFunction {
    return typeof value === 'function';
}

export function normalizeGraphPoint(
    renderer: MinimapRenderer,
    point: GraphPoint,
): GraphPoint {
    const normalizationFunction = sigmaRuntime(renderer).normalizationFunction;
    if (!isNormalizationFunction(normalizationFunction)) {
        throw new TypeError('Sigma normalization function is unavailable');
    }
    return normalizationFunction.call(renderer, point);
}

export function isRendererKilled(renderer: MinimapRenderer): boolean {
    return sigmaRuntime(renderer).killed === true;
}

export function visibleCameraRatio(
    renderer: MinimapRenderer,
    bounds: Parameters<typeof getVisibleCameraRatio>[1],
): number {
    const normalizationFunction = sigmaRuntime(renderer).normalizationFunction;
    return getVisibleCameraRatio({
        getCamera: () => renderer.getCamera(),
        getDimensions: () => renderer.getDimensions(),
        getGraphToViewportRatio: () => renderer.getGraphToViewportRatio(),
        normalizationFunction: isNormalizationFunction(normalizationFunction)
            ? { ratio: normalizationFunction.ratio }
            : undefined,
    }, bounds);
}

export function findClosestVisibleNode(
    graph: MinimapGraph,
    graphPosition: GraphPoint,
): string | null {
    let closestNode: string | null = null;
    let minimumDistance = Infinity;
    graph.forEachNode((node, attributes) => {
        if (attributes.hidden) return;
        const dx = attributes.x - graphPosition.x;
        const dy = attributes.y - graphPosition.y;
        const distance = dx * dx + dy * dy;
        if (distance < minimumDistance) {
            minimumDistance = distance;
            closestNode = node;
        }
    });
    return closestNode;
}
