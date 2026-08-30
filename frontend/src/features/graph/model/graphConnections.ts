import type Graph from 'graphology';

import { applyFilters, type FilterGraph } from '../../../utils/graphFilters';
import {
  getConnectionType,
  type ConnectionAttributes,
  type ConnectionType,
} from './graphLegend';
import {
  getVisibleSemanticEdges,
  type SemanticEdge,
  type SemanticReason,
} from '../../../shared/graph/model/semanticOverlay';

interface ConnectionNodeAttributes {
  [key: string]: unknown;
  label?: string | null;
  url?: string;
}

interface ConnectionEdgeAttributes extends ConnectionAttributes {
  directed?: unknown;
  evidence?: SemanticReason;
  reason?: SemanticReason;
  reasons?: SemanticReason;
}

type FilterOptions = Parameters<typeof applyFilters>[1];
export interface ConnectionFilters extends FilterOptions {
  [key: string]: unknown;
  showSemanticSuggestions?: unknown;
}

interface ConnectionTarget {
  directed: boolean;
  id: string;
  label: string;
  reason: string;
  type: ConnectionType;
  url?: string;
}

interface ConnectionGroup {
  id: string;
  label: string;
  targets: ConnectionTarget[];
  url?: string;
}

// Consumers only inspect topology: mutation methods unnecessarily make Graph's
// attribute generics invariant and reject richer graphs such as the viewer's.
export type ConnectionGraph = FilterGraph & Pick<Graph<ConnectionNodeAttributes, ConnectionEdgeAttributes>,
  'hasNode' | 'getNodeAttributes' | 'getNodeAttribute' | 'getEdgeAttributes' |
  'forEachNode' | 'forEachEdge' | 'neighbors' | 'source' | 'target'>;

function normalizedReason(attrs: ConnectionEdgeAttributes): string {
  const raw = attrs.reason || attrs.reasons || attrs.evidence || '';
  return Array.isArray(raw)
    ? raw.filter(Boolean).join(', ')
    : String(raw || '');
}

export function getVisibleConnectionGroups(
  graph: ConnectionGraph | null | undefined,
  filters: ConnectionFilters,
  transportEdges: readonly SemanticEdge[] = [],
): ConnectionGroup[] {
  if (!graph) return [];

  const { visibleNodes, visibleEdges } = applyFilters(graph, filters);
  const groups = new Map<string, ConnectionGroup>();

  const addConnection = (
    id: string,
    source: string,
    target: string,
    attrs: ConnectionEdgeAttributes,
  ): void => {
    if (!graph.hasNode(source) || !graph.hasNode(target)) return;
    const sourceAttrs = graph.getNodeAttributes(source);
    const targetAttrs = graph.getNodeAttributes(target);
    if (!groups.has(source)) {
      groups.set(source, {
        id: source,
        label: sourceAttrs.label || source,
        url: sourceAttrs.url,
        targets: [],
      });
    }
    const group = groups.get(source);
    if (!group) return;
    group.targets.push({
      id,
      label: targetAttrs.label || target,
      url: targetAttrs.url,
      type: getConnectionType(attrs),
      directed: Boolean(attrs.directed),
      reason: normalizedReason(attrs),
    });
  };

  visibleEdges.forEach((edge) => {
    addConnection(
      edge,
      graph.source(edge),
      graph.target(edge),
      graph.getEdgeAttributes(edge),
    );
  });

  getVisibleSemanticEdges(
    transportEdges,
    visibleNodes,
    filters.showSemanticSuggestions,
  ).forEach((edge, index) => {
    const source = String(edge.source);
    const target = String(edge.target);
    const suggestionId = String(edge.suggestion_id || index);
    addConnection(
      `semantic:${suggestionId}:${source}:${target}`,
      source,
      target,
      { ...edge, directed: false },
    );
  });

  groups.forEach((group) => {
    group.targets.sort(
      (left, right) =>
        left.type.localeCompare(right.type) ||
        left.label.localeCompare(right.label),
    );
  });

  return [...groups.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}
