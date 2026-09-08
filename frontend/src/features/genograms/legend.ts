import type { Config, Person, Relation } from './model';

export function legendKeys(people: Person[], relations: Relation[], config: Config): string[] {
  const keys = new Set<string>();
  for (const p of people) {
    keys.add(p.kind === 'pregnancy' ? `pregnancy_${p.pregnancy_status}` : `symbol_${p.symbol}`);
    if (p.vital_status === 'deceased' || p.vital_status === 'stillborn') keys.add(p.vital_status);
    if (p.multiple_group) keys.add(`multiple_${p.multiple_type}`);
  }
  if (people.some(person => person.id === config.root_id)) keys.add('reference');
  for (const r of relations) {
    if (r.kind === 'union') { keys.add(`union_${r.union_type}`); if (r.union_status && r.union_status !== 'active') keys.add(`status_${r.union_status}`); }
    if (r.kind === 'parent') keys.add(`parent_${r.parentage}`);
    if (r.kind === 'emotional' && config.emotional) keys.add(`emotion_${r.emotion}`);
  }
  return [...keys].sort();
}
export const legendHeight = (keys: string[]) => keys.length * 25 + 80;
