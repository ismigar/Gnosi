type VaultContextScalar = string | number | boolean | null | undefined;


interface VaultContextEntity {
  readonly content?: string | null;
  readonly id?: VaultContextScalar;
  readonly name?: VaultContextScalar;
  readonly title?: VaultContextScalar;
}


export interface VaultAgentContextInput {
  readonly page?: VaultContextEntity | null;
  readonly table?: VaultContextEntity | null;
  readonly view?: VaultContextEntity | null;
}


export interface VaultAgentContextRef {
  readonly id: string;
  readonly label: string;
  readonly ref: string;
  readonly scope?: {
    readonly view_id: string;
    readonly view_name: string;
  };
  readonly type: 'page' | 'table' | 'vault';
}


const stableRef = (prefix: string, value: VaultContextScalar): string => (
  `${prefix}:${String(value)}`
);


function markerViewId(payload: string): string {
  const parsed: unknown = JSON.parse(payload);
  if (typeof parsed !== 'object' || parsed === null) return '';
  const viewId = (parsed as Record<string, unknown>).view_id;
  if (typeof viewId !== 'string' && typeof viewId !== 'number') return '';
  return String(viewId).trim();
}


export function vaultPageViewIds(
  page: VaultContextEntity | null = null,
): string[] {
  const content = page?.content ?? '';
  const viewIds: string[] = [];
  const marker = /<!--\s*gnosi-view:def\s+(\{[\s\S]*?\})\s*-->/g;
  let match = marker.exec(content);
  while (match) {
    try {
      const payload = match[1];
      const viewId = payload ? markerViewId(payload) : '';
      if (viewId && !viewIds.includes(viewId)) viewIds.push(viewId);
    } catch {
      // Ignore malformed page-owned markers; the page remains valid context.
    }
    match = marker.exec(content);
  }
  return viewIds;
}


export function vaultAgentContextRefs({
  page = null,
  table = null,
  view = null,
}: VaultAgentContextInput = {}): VaultAgentContextRef[] {
  const refs: VaultAgentContextRef[] = [];
  const pageId = String(page?.id ?? '').trim();
  const tableId = String(table?.id ?? '').trim();
  const viewId = String(view?.id ?? '').trim();

  if (pageId) {
    refs.push({
      id: stableRef('vault-page', pageId),
      type: 'page',
      ref: pageId,
      label: String(page?.title || page?.name || pageId),
    });
  }
  if (tableId) {
    const tableRef: VaultAgentContextRef = {
      id: stableRef('vault-table', tableId),
      type: 'table',
      ref: tableId,
      label: String(table?.name || table?.title || tableId),
      ...(viewId
        ? {
            scope: {
              view_id: viewId,
              view_name: String(view?.name || viewId),
            },
          }
        : {}),
    };
    refs.push(tableRef);
  }
  if (refs.length === 0) {
    refs.push({
      id: 'route-vault',
      type: 'vault',
      ref: 'active-vault',
      label: 'Knowledge',
    });
  }
  return refs;
}
