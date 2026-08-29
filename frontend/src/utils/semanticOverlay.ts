export const SEMANTIC_SUGGESTION_COLOR = '#a855f7';

export type SemanticReason =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly unknown[];

export interface SemanticEdge {
  [key: string]: unknown;
  kind?: unknown;
  reason?: SemanticReason;
  reasons?: SemanticReason;
  source?: unknown;
  suggestion_id?: string | number | boolean | null;
  target?: unknown;
}

interface GraphPoint {
  x: number;
  y: number;
}

interface SemanticNodeAttributes {
  [key: string]: unknown;
  hidden?: unknown;
  x?: unknown;
  y?: unknown;
}

interface SemanticGraphLike {
  getNodeAttributes(node: string): SemanticNodeAttributes;
  hasNode(node: string): boolean;
}

interface SemanticOverlaySegment {
  edge: SemanticEdge;
  source: GraphPoint;
  target: GraphPoint;
}

type GraphToViewport = (point: GraphPoint) => GraphPoint;

export function hasSemanticSuggestions(
  edges: readonly SemanticEdge[] | null | undefined,
): boolean {
  return (edges || []).some((edge) => edge.kind === 'suggestion');
}

/** Returns pending Brain proposals whose endpoints are currently visible. */
export function getVisibleSemanticEdges(
  edges: readonly SemanticEdge[] | null | undefined,
  visibleNodes: ReadonlySet<string>,
  enabled: unknown,
): SemanticEdge[] {
  if (!enabled) return [];

  return (edges || []).filter(
    (edge) =>
      edge.kind === 'suggestion' &&
      visibleNodes.has(String(edge.source)) &&
      visibleNodes.has(String(edge.target)),
  );
}

/** Projects proposals without mutating the structural Graphology instance. */
export function getSemanticOverlaySegments(
  edges: readonly SemanticEdge[] | null | undefined,
  graph: SemanticGraphLike | null | undefined,
  graphToViewport: GraphToViewport | null | undefined,
): SemanticOverlaySegment[] {
  if (!graph || typeof graphToViewport !== 'function') return [];

  return (edges || []).flatMap((edge) => {
    if (edge.kind !== 'suggestion') return [];
    const source = String(edge.source);
    const target = String(edge.target);
    if (!graph.hasNode(source) || !graph.hasNode(target)) return [];

    const sourceAttrs = graph.getNodeAttributes(source);
    const targetAttrs = graph.getNodeAttributes(target);
    if (sourceAttrs.hidden || targetAttrs.hidden) return [];

    const sourceX = Number(sourceAttrs.x);
    const sourceY = Number(sourceAttrs.y);
    const targetX = Number(targetAttrs.x);
    const targetY = Number(targetAttrs.y);
    if (![sourceX, sourceY, targetX, targetY].every(Number.isFinite)) {
      return [];
    }

    return [
      {
        edge,
        source: graphToViewport({ x: sourceX, y: sourceY }),
        target: graphToViewport({ x: targetX, y: targetY }),
      },
    ];
  });
}
