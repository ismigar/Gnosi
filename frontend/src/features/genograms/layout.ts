import { personLabel, type Config, type Person, type Position, type Relation } from './model';
export interface LayoutInput { people: Person[]; relations: Relation[]; config: Config }
export interface Layout { positions: Record<string, Position>; width: number; height: number; minX: number; minY: number }

/** Family ranks are authoritative; emotional edges never enter layout. */
export function layoutGenogram({ people, relations, config }: LayoutInput): Layout {
  const ids = people.map(p => p.id).sort();
  const idSet = new Set(ids);
  const parents = relations.filter(r => r.kind === 'parent' && idSet.has(r.source) && idSet.has(r.target));
  const representative = new Map(ids.map(id => [id, id]));
  const group = (id: string): string => representative.get(id) ?? id;
  const adjacency = (): Map<string, Set<string>> => {
    const result = new Map<string, Set<string>>();
    for (const r of parents) {
      const a = group(r.source), b = group(r.target);
      if (a !== b) { if (!result.has(a)) result.set(a, new Set()); result.get(a)?.add(b); }
    }
    return result;
  };
  const reaches = (start: string, end: string, graph: Map<string, Set<string>>): boolean => {
    const pending = [start], seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop();
      if (current === undefined) break;
      if (current === end) return true;
      if (seen.has(current)) continue;
      seen.add(current); pending.push(...(graph.get(current) ?? []));
    }
    return false;
  };
  // Merge partner ranks only if the resulting family DAG stays acyclic.
  for (const r of relations.filter(r => r.kind === 'union').sort((a, b) => a.id.localeCompare(b.id))) {
    if (!idSet.has(r.source) || !idSet.has(r.target)) continue;
    const a = group(r.source), b = group(r.target);
    const graph = adjacency();
    if (a === b || reaches(a, b, graph) || reaches(b, a, graph)) continue;
    for (const id of ids) if (group(id) === b) representative.set(id, a);
  }
  const graph = adjacency(), ranks = new Map<string, number>();
  const groups = new Set(ids.map(group)), incoming = new Map([...groups].map(id => [id, 0]));
  for (const children of graph.values()) for (const child of children) incoming.set(child, (incoming.get(child) ?? 0) + 1);
  const queue = [...groups].filter(id => incoming.get(id) === 0).sort();
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined) break;
    for (const child of graph.get(id) ?? []) {
      ranks.set(child, Math.max(ranks.get(child) ?? 0, (ranks.get(id) ?? 0) + 1));
      incoming.set(child, (incoming.get(child) ?? 1) - 1);
      if (incoming.get(child) === 0) queue.push(child);
    }
  }
  const parentIds = new Map<string, string[]>();
  for (const r of parents) { const list = parentIds.get(r.target) ?? []; list.push(r.source); parentIds.set(r.target, list); }
  const rows = new Map<number, Person[]>();
  for (const person of people) { const rank = ranks.get(group(person.id)) ?? 0; const row = rows.get(rank) ?? []; row.push(person); rows.set(rank, row); }
  const positions: Record<string, Position> = {};
  const spacing = Math.max(180, ...people.map(p => personLabel(p, config.labels).length * 7 + 40));
  const margin = Math.max(100, spacing / 2);
  const childUnions = new Map<string, string[]>();
  for (const r of parents) if (r.union_id) { const list = childUnions.get(r.target) ?? []; list.push(r.union_id); childUnions.set(r.target, list); }
  const familyKey = (p: Person): string => [...new Set(childUnions.get(p.id) ?? [])].sort().join('|') || (parentIds.get(p.id) ?? []).sort().join('|') || group(p.id);
  for (const [rank, row] of [...rows.entries()].sort(([a], [b]) => a - b)) {
    const familyMean = (p: Person): number => {
      const points = (parentIds.get(p.id) ?? []).map(id => positions[id]?.x).filter((x): x is number => x !== undefined);
      return points.length ? points.reduce((a, b) => a + b, 0) / points.length : 0;
    };
    row.sort((a, b) => {
      if (familyKey(a) !== familyKey(b)) return familyMean(a) - familyMean(b) || familyKey(a).localeCompare(familyKey(b));
      if (a.multiple_group && a.multiple_group === b.multiple_group) return (a.birth_order ?? 0) - (b.birth_order ?? 0) || a.id.localeCompare(b.id);
      return (a.birth_order ?? Infinity) - (b.birth_order ?? Infinity) || (a.birth_date || '9999').localeCompare(b.birth_date || '9999') || (a.multiple_group).localeCompare(b.multiple_group) || a.id.localeCompare(b.id);
    });
    // Place each partner group contiguously, with its most connected person
    // between partners. Multiple births form indivisible sibling groups.
    const ordered: Person[] = [], used = new Set<string>();
    for (const person of row) {
      if (used.has(person.id)) continue;
      let block = row.filter(other => !used.has(other.id) && group(other.id) === group(person.id));
      if (block.length === 1 && person.multiple_group) block = row.filter(other => !used.has(other.id) && other.multiple_group === person.multiple_group && familyKey(other) === familyKey(person));
      if (block.length > 2 && !person.multiple_group) {
        const degree = (p: Person) => relations.filter(r => r.kind === 'union' && (r.source === p.id || r.target === p.id)).length;
        const pivot = [...block].sort((a, b) => degree(b) - degree(a) || a.id.localeCompare(b.id))[0];
        if (pivot) { const others = block.filter(p => p.id !== pivot.id); const middle = Math.ceil(others.length / 2); block = [...others.slice(0, middle), pivot, ...others.slice(middle)]; }
      }
      for (const item of block) { used.add(item.id); ordered.push(item); }
    }
    ordered.forEach((person, index) => { positions[person.id] = { x: 100 + index * spacing, y: 120 + rank * 210 }; });
  }
  for (const id of ids) {
    const point = config.positions?.[id];
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) positions[id] = point;
  }
  const points = Object.values(positions);
  const minX = Math.min(0, ...points.map(p => p.x - margin));
  const minY = Math.min(0, ...points.map(p => p.y - 100));
  return { positions, minX, minY, width: Math.max(500, ...points.map(p => p.x + margin)) - minX, height: Math.max(280, ...points.map(p => p.y + 100)) - minY };
}
