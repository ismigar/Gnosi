import Graph from 'graphology';

import type { ConfigurationDocument } from '../../../shared/api/configuration';
import type {
  VaultGraphData,
  VaultGraphEdge,
  VaultGraphNode,
} from '../../../shared/api/graph';
import type { VaultGlobalIndex } from '../../../shared/api/vaults';
import {
  getEffectiveTableId,
  getSystemCategory,
  resolveMetaValue,
  toValueStrings,
} from '../../../utils/graphFilters';
import type { FilterItem, FilterValue } from '../../../utils/vaultFilters';


export interface GraphNodeAttributes extends FilterItem {
  cluster?: string | null;
  created_time?: string | number | null;
  database_id?: string | null;
  database_table_id?: string | null;
  hidden?: boolean;
  kind?: string | null;
  label?: string | null;
  metadata?: Readonly<Record<string, unknown>>;
  path?: string | null;
  project?: string | null;
  table_id?: string | null;
  tags?: readonly string[];
  x: number;
  y: number;
}


export interface GraphEdgeAttributes extends Readonly<Record<string, unknown>> {
  body_link?: boolean;
  hidden?: unknown;
  kind?: string | null;
}


export type GraphPageGraph = Graph<GraphNodeAttributes, GraphEdgeAttributes>;
export type GraphData = VaultGraphData;


export interface GraphPathResult {
  readonly edges: ReadonlySet<string>;
  readonly fullPath: readonly string[];
  readonly nodes: ReadonlySet<string>;
  readonly noPath?: boolean;
}


export interface GraphPhysicsSettings {
  readonly edge_influence?: number;
  readonly friction?: number;
  readonly gravity?: number;
  readonly lin_log_mode?: boolean;
  readonly outbound_attraction_distribution?: boolean;
  readonly repulsion?: number;
  readonly strong_gravity_mode?: boolean;
}


export interface GraphSettings {
  readonly edge_thickness?: number;
  readonly field_defaults?: Readonly<Record<string, string>>;
  readonly graph_table_filters?: readonly string[];
  readonly label_threshold?: number;
  readonly node_size?: number;
  readonly physics?: GraphPhysicsSettings;
  readonly show_arrows?: boolean;
  readonly sources_initialized?: boolean;
  readonly visible_databases?: readonly string[];
  readonly visible_fields?: readonly string[];
  readonly visible_tables?: readonly string[];
}


export interface GraphSourceSelection {
  readonly databases: string[];
  readonly tables: string[];
}


export type FieldFilters = Readonly<Record<
  string,
  ReadonlySet<string> | undefined
>>;
export type FieldValuesByKey = Readonly<Record<
  string,
  readonly (readonly [string, number])[]
>>;


function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function optionalString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}


function optionalFiniteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}


function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map(optionalString)
    .filter((item): item is string => item !== null);
}


function toFilterValue(value: unknown): FilterValue {
  if (
    value === null
    || value === undefined
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'bigint'
  ) return value;
  if (Array.isArray(value)) return value.map(toFilterValue);
  if (!isRecord(value)) return '';
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toFilterValue(item)]),
  );
}


function filterRecord(value: unknown): Readonly<Record<string, FilterValue>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toFilterValue(item)]),
  );
}


export function graphNodeAttributes(node: VaultGraphNode): GraphNodeAttributes {
  const attributes: GraphNodeAttributes = { x: 0, y: 0 };
  Object.entries(node).forEach(([key, value]) => {
    attributes[key] = toFilterValue(value);
  });
  attributes.cluster = optionalString(node.cluster);
  attributes.database_id = optionalString(node.database_id);
  attributes.kind = node.kind;
  attributes.label = node.label;
  attributes.metadata = filterRecord(node.metadata);
  attributes.path = node.path;
  attributes.table_id = optionalString(node.table_id);
  attributes.x = typeof node.x === 'number' ? node.x : 0;
  attributes.y = typeof node.y === 'number' ? node.y : 0;
  const createdTime = node.created_time;
  if (typeof createdTime === 'string' || typeof createdTime === 'number') {
    attributes.created_time = createdTime;
  }
  return attributes;
}


function graphEdgeAttributes(edge: VaultGraphEdge): GraphEdgeAttributes {
  return edge;
}


export function graphSettingsFromDocument(
  document: ConfigurationDocument | null,
): GraphSettings | null {
  const graph = document?.graph;
  if (!isRecord(graph)) return null;
  const fieldDefaults = isRecord(graph.field_defaults)
    ? Object.fromEntries(
      Object.entries(graph.field_defaults).flatMap(([key, value]) => {
        const normalized = optionalString(value);
        return normalized === null ? [] : [[key, normalized]];
      }),
    )
    : undefined;
  const physics = isRecord(graph.physics) ? graph.physics : {};
  return {
    edge_thickness: optionalFiniteNumber(graph.edge_thickness),
    field_defaults: fieldDefaults,
    graph_table_filters: stringArray(graph.graph_table_filters),
    label_threshold: optionalFiniteNumber(graph.label_threshold),
    node_size: optionalFiniteNumber(graph.node_size),
    physics: {
      edge_influence: optionalFiniteNumber(physics.edge_influence),
      friction: optionalFiniteNumber(physics.friction),
      gravity: optionalFiniteNumber(physics.gravity),
      lin_log_mode: typeof physics.lin_log_mode === 'boolean'
        ? physics.lin_log_mode
        : undefined,
      outbound_attraction_distribution:
        typeof physics.outbound_attraction_distribution === 'boolean'
          ? physics.outbound_attraction_distribution
          : undefined,
      repulsion: optionalFiniteNumber(physics.repulsion),
      strong_gravity_mode: typeof physics.strong_gravity_mode === 'boolean'
        ? physics.strong_gravity_mode
        : undefined,
    },
    show_arrows: typeof graph.show_arrows === 'boolean'
      ? graph.show_arrows
      : undefined,
    sources_initialized: Boolean(graph.sources_initialized),
    visible_databases: stringArray(graph.visible_databases),
    visible_fields: stringArray(graph.visible_fields),
    visible_tables: stringArray(graph.visible_tables),
  };
}


export function seedGraphConfigurationDocument(
  document: ConfigurationDocument | null,
  selection: GraphSourceSelection,
): ConfigurationDocument | null {
  if (!document) return document;
  const currentGraph = isRecord(document.graph) ? document.graph : {};
  return {
    ...document,
    graph: {
      ...currentGraph,
      sources_initialized: true,
      visible_databases: selection.databases,
      visible_tables: selection.tables,
    },
  };
}


export function deriveGraphSources(
  nodes: readonly VaultGraphNode[],
): GraphSourceSelection {
  const databases = new Set<string>();
  const tables = new Set<string>();
  nodes.forEach((node) => {
    const attributes = graphNodeAttributes(node);
    const category = getSystemCategory(attributes);
    if (category) {
      databases.add(category);
      const table = getEffectiveTableId(attributes);
      if (table) tables.add(table);
    } else {
      const database = optionalString(
        node.database_id || attributes.metadata?.database_id,
      );
      const table = optionalString(
        node.table_id || attributes.metadata?.table_id
          || attributes.metadata?.database_table_id,
      );
      if (database) databases.add(database);
      if (table) tables.add(table);
    }
  });
  return { databases: [...databases], tables: [...tables] };
}


export function buildFilterGraph(data: GraphData | null): GraphPageGraph | null {
  if (!data?.nodes) return null;
  const graph = new Graph<GraphNodeAttributes, GraphEdgeAttributes>();
  data.nodes.forEach((node) => {
    graph.addNode(String(node.key), graphNodeAttributes(node));
  });
  data.edges.forEach((edge) => {
    if (edge.kind !== 'link' && !edge.body_link) return;
    try {
      graph.addEdge(
        String(edge.source),
        String(edge.target),
        graphEdgeAttributes(edge),
      );
    } catch {
      // Duplicate or dangling structural edge: legacy behavior ignores it.
    }
  });
  return graph;
}


export function findShortestPath(
  graph: GraphPageGraph | null,
  source: string | null,
  target: string | null,
): GraphPathResult | null {
  if (!graph || !source || !target) return null;
  const queue: string[][] = [[source]];
  const visited = new Set([source]);
  while (queue.length > 0) {
    const path = queue.shift();
    const node = path?.at(-1);
    if (!path || !node) continue;
    if (node === target) {
      const edges = new Set<string>();
      path.slice(0, -1).forEach((current, index) => {
        const next = path[index + 1];
        if (!next) return;
        const edge = graph.edge(current, next) || graph.edge(next, current);
        if (edge) edges.add(edge);
      });
      return { edges, fullPath: path, nodes: new Set(path) };
    }
    graph.neighbors(node).forEach((neighbor) => {
      if (visited.has(neighbor)) return;
      visited.add(neighbor);
      queue.push([...path, neighbor]);
    });
  }
  return {
    edges: new Set(),
    fullPath: [],
    noPath: true,
    nodes: new Set(),
  };
}


export function deriveFieldValues(
  data: GraphData | null,
  visibleFields: readonly string[],
): FieldValuesByKey {
  const result: Record<string, Array<readonly [string, number]>> = {};
  visibleFields.forEach((fieldKey) => {
    if (!fieldKey.includes(':')) return;
    const [tableId = '', fieldName = ''] = fieldKey.split(':');
    const counts = new Map<string, number>();
    data?.nodes.forEach((node) => {
      const attributes = graphNodeAttributes(node);
      if (getEffectiveTableId(attributes) !== tableId) return;
      toValueStrings(resolveMetaValue(attributes, fieldName)).forEach((value) => {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      });
    });
    result[fieldKey] = [...counts.entries()].sort((left, right) => (
      right[1] - left[1]
    ));
  });
  return result;
}


export function deriveIdLabels(
  data: GraphData | null,
  globalIndex: VaultGlobalIndex,
): Record<string, string> {
  const result = { ...globalIndex };
  data?.nodes.forEach((node) => {
    if (!node.label) return;
    [node.id, node.key, node.metadata.id].forEach((key) => {
      if (!key) return;
      const normalized = optionalString(key);
      if (normalized && !(normalized in result)) result[normalized] = node.label;
    });
  });
  return result;
}


export function deriveFolderNames(
  data: GraphData | null,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  data?.nodes.forEach((node) => {
    const metadata = isRecord(node.metadata) ? node.metadata : {};
    const tableId = optionalString(
      node.table_id || metadata.table_id || metadata.database_table_id,
    );
    if (!tableId || result.has(tableId)) return;
    const segments = node.path.split('/').filter(Boolean);
    const folder = segments.at(-2);
    if (folder) result.set(tableId, folder);
  });
  return result;
}


export function deriveMediaTags(data: GraphData | null): string[] {
  const tags = new Set<string>();
  data?.nodes.forEach((node) => {
    if (node.kind !== 'media') return;
    const rawTags = node.metadata.tags;
    if (!Array.isArray(rawTags)) return;
    rawTags.forEach((tag) => {
      const normalized = optionalString(tag);
      if (normalized !== null) tags.add(normalized);
    });
  });
  return [...tags].sort();
}


export function deriveTimelineRange(
  data: GraphData | null,
): readonly [number, number] | null {
  const times = (data?.nodes ?? []).flatMap((node) => {
    const raw = node.created_time;
    if (!raw) return [];
    if (typeof raw !== 'string' && typeof raw !== 'number') return [];
    const value = new Date(raw).getTime();
    return Number.isFinite(value) ? [value] : [];
  });
  return times.length > 0 ? [Math.min(...times), Math.max(...times)] : null;
}


export function displayGraphFieldValue(
  value: string,
  idLabels: Readonly<Record<string, string>>,
): string {
  if (idLabels[value]) return idLabels[value];
  const looksLikeId = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value)
    || /^[0-9a-f]{32}$/i.test(value);
  return looksLikeId ? `${value.slice(0, 8)}…` : value;
}
