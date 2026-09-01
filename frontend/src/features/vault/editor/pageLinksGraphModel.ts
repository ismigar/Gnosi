type ConnectionKind = 'outgoing' | 'incoming' | 'relation';

const KIND_ORDER: readonly ConnectionKind[] = [
  'outgoing',
  'incoming',
  'relation',
];
type PageLinkValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

interface PageLink {
  id?: PageLinkValue;
  title?: PageLinkValue;
}

interface BuildPageLinksGraphOptions {
  incomingLinks?: unknown;
  outgoingLinks?: unknown;
  relatedPages?: unknown;
}

interface MutablePageLinksGraphNode {
  id: string;
  key: string;
  kinds: Set<ConnectionKind>;
  title: string;
}

interface PageLinksGraphNode {
  id: string;
  key: string;
  kinds: ConnectionKind[];
  title: string;
  visualKind: ConnectionKind | 'mixed';
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPageLinkValue(
  item: unknown,
  key: keyof PageLink,
): PageLinkValue {
  if (!isUnknownRecord(item)) return undefined;
  const value = item[key];
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return undefined;
}

export function truncateGraphLabel(
  value?: PageLinkValue,
  maxCharacters = 22,
): string {
  const label = String(value || '').trim();
  if (label.length <= maxCharacters) return label;
  return `${label
    .slice(0, Math.max(1, maxCharacters - 1))
    .trimEnd()}…`;
}

function connectionKey(item: unknown, kind: ConnectionKind): string {
  const id = String(readPageLinkValue(item, 'id') || '').trim();
  if (id) return `id:${id}`;
  return `${kind}:title:${String(
    readPageLinkValue(item, 'title') || '',
  )
    .trim()
    .toLocaleLowerCase()}`;
}

export function buildPageLinksGraphModel({
  outgoingLinks = [],
  incomingLinks = [],
  relatedPages = [],
}: BuildPageLinksGraphOptions): PageLinksGraphNode[] {
  const nodesByKey = new Map<string, MutablePageLinksGraphNode>();
  const addItems = (items: unknown, kind: ConnectionKind): void => {
    const safeItems: readonly unknown[] = Array.isArray(items) ? items : [];
    for (const item of safeItems) {
      const title = String(
        readPageLinkValue(item, 'title') ||
          readPageLinkValue(item, 'id') ||
          '',
      ).trim();
      if (!title) continue;
      const key = connectionKey(item, kind);
      const existing = nodesByKey.get(key);
      if (existing) {
        existing.kinds.add(kind);
        continue;
      }
      nodesByKey.set(key, {
        key,
        id: String(readPageLinkValue(item, 'id') || '').trim(),
        title,
        kinds: new Set([kind]),
      });
    }
  };

  addItems(outgoingLinks, 'outgoing');
  addItems(incomingLinks, 'incoming');
  addItems(relatedPages, 'relation');

  return Array.from(nodesByKey.values())
    .map((node): PageLinksGraphNode => {
      const kinds = KIND_ORDER.filter((kind) => node.kinds.has(kind));
      return {
        ...node,
        kinds,
        visualKind: kinds.length === 1 ? (kinds.at(0) ?? 'mixed') : 'mixed',
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}
