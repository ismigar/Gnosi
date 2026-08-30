export const CONNECTION_TYPE_COLORS = {
  wikilink: '#10b981',
  database_wikilink: '#6366f1',
  unresolved: '#cbd5e1',
  semantic_similarity: '#a855f7',
} as const;

export type ConnectionType = keyof typeof CONNECTION_TYPE_COLORS;

export interface ConnectionAttributes {
  [key: string]: unknown;
  kind?: unknown;
  unresolved?: unknown;
}

export function getConnectionType(
  attrs: ConnectionAttributes,
): ConnectionType {
  if (attrs.unresolved) return 'unresolved';
  if (attrs.kind === 'suggestion') return 'semantic_similarity';
  if (attrs.kind === 'relation') return 'database_wikilink';
  return 'wikilink';
}

export function getConnectionTypeCounts(
  edgeAttributes: readonly ConnectionAttributes[],
): Partial<Record<ConnectionType, number>> {
  return edgeAttributes.reduce<Partial<Record<ConnectionType, number>>>(
    (counts, attrs) => {
      const type = getConnectionType(attrs);
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    },
    {},
  );
}
