import { legendKeys } from './legend';
import type { TFunction } from 'i18next';
import type { Config, Person, Relation, Position } from './model';
import { personAge, personLabel } from './model';
import type { Layout } from './layout';
import { EmotionStroke, PersonSymbol } from './symbols';

interface SceneProps { people: Person[]; relations: Relation[]; layout: Layout; config: Config; t: TFunction; selected?: string; search?: string; title: string }

function FamilyLines({ relations, people, positions, config }: Pick<SceneProps, 'relations' | 'people' | 'config'> & { positions: Record<string, Position> }) {
  const unions = new Map<string, Position>();
  const peopleById = new Map(people.map(p => [p.id, p]));
  const unionLines = relations.filter(r => r.kind === 'union').map((r, index) => {
    const a = positions[r.source], b = positions[r.target];
    if (!a || !b) return null;
    const sign = b.x >= a.x ? 1 : -1;
    const obstructed = Object.entries(positions).some(([id, p]) => id !== r.source && id !== r.target && Math.abs(p.y - a.y) < 35 && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x));
    const lane = a.y === b.y && !obstructed ? a.y : Math.min(a.y, b.y) - 45 - index % 3 * 14;
    const middle = (a.x + b.x) / 2;
    const columns = Object.values(positions).filter(p => p.y >= lane && p.y <= Math.max(a.y, b.y)).map(p => p.x).sort((x, y) => x - y);
    const candidates = [middle, ...columns.slice(1).map((x, i) => (x + (columns[i] ?? x)) / 2)];
    const junctionX = candidates.filter(x => x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x) && columns.every(column => Math.abs(column - x) >= 65)).sort((x, y) => Math.abs(x - middle) - Math.abs(y - middle) || x - y)[0] ?? middle;
    const mid = { x: junctionX, y: lane };
    unions.set(r.id, mid);
    const d = `M ${String(a.x + sign * 23)} ${String(a.y)} H ${String(a.x + sign * 35)} V ${String(lane)} H ${String(b.x - sign * 35)} V ${String(b.y)} H ${String(b.x - sign * 23)}`;
    return <g key={r.id} data-relation={r.id} role="button" tabIndex={0} aria-label={r.title || r.union_type}>
      <path d={d} stroke="transparent" strokeWidth={14} />
      <path d={d} strokeDasharray={r.union_type === 'marriage' ? undefined : r.union_type === 'coparenting' ? '2 5' : '7 4'} />
      {(r.union_status === 'separated' || r.union_status === 'divorced') && <path d={`M ${String(mid.x - 5)} ${String(lane + 7)} l 10 -14 ${r.union_status === 'divorced' ? 'm -3 14 l 10 -14' : ''}`} />}
      {r.union_status === 'ended' && <path d={`M ${String(mid.x - 5)} ${String(lane - 5)} l 10 10 m -10 0 l 10 -10`} />}
    </g>;
  });
  const families = new Map<string, Relation[]>();
  for (const r of relations.filter(r => r.kind === 'parent')) {
    const key = r.union_id && unions.has(r.union_id) ? r.union_id : `parent:${r.source}`;
    const family = families.get(key) ?? []; family.push(r); families.set(key, family);
  }
  const parentLines = [...families].map(([key, links], familyIndex) => {
    const source = unions.get(key) ?? positions[links[0]?.source ?? ''];
    if (!source) return null;
    const seen = new Set<string>();
    const children = links.filter(r => { const k = `${r.target}:${r.parentage}`; if (!positions[r.target] || seen.has(k)) return false; seen.add(k); return true; });
    const busY = Math.min(...children.map(r => (positions[r.target]?.y ?? 0))) - 85 - familyIndex % 3 * 12;
    const startY = source.y;
    const parent = peopleById.get(links[0]?.source ?? '');
    const clearance = Math.max(42, parent ? personLabel(parent, config.labels).length * 3.5 + 16 : 42, config.dates ? 75 : 0);
    const trunkX = unions.has(key) ? source.x : source.x + clearance;
    const trunk = unions.has(key) ? `M ${String(source.x)} ${String(startY)}` : `M ${String(source.x + 23)} ${String(startY)} H ${String(trunkX)}`;
    return <g key={key}>{children.map(r => {
      const child = positions[r.target];
      if (!child) return null;
      const person = peopleById.get(r.target);
      const twins = person?.multiple_group ? children.filter(other => peopleById.get(other.target)?.multiple_group === person.multiple_group) : [];
      const jointX = twins.length > 1 ? twins.reduce((sum, other) => sum + (positions[other.target]?.x ?? 0), 0) / twins.length : child.x;
      const d = `${trunk} V ${String(busY)} H ${String(jointX)} ${twins.length > 1 ? `L ${String(child.x)} ${String(child.y - 24)}` : `V ${String(child.y - 24)}`}`;
      return <g key={r.id} data-relation={r.id} role="button" tabIndex={0} aria-label={r.title || r.parentage}>
        <path d={d} stroke="transparent" strokeWidth={14} />
        <path d={d} strokeDasharray={r.parentage === 'adoptive' ? '8 4' : r.parentage === 'foster' ? '2 5' : r.parentage === 'unknown' ? '8 3 2 3' : undefined} />
        {twins.length > 1 && person?.multiple_type === 'identical' && <path d={`M ${String(jointX + (child.x - jointX) * .55)} ${String(busY + (child.y - 24 - busY) * .55)} H ${String(jointX)}`} />}
      </g>;
    })}</g>;
  });
  return <g fill="none" stroke="#202020" strokeWidth={1.5}>{unionLines}{parentLines}</g>;
}

function LegendSymbol({ value }: { value: string }) {
  if (value.startsWith('emotion_')) return <EmotionStroke relation={{ emotion: value.slice(8) }} x1={0} y1={0} x2={45} y2={0} />;
  if (value.startsWith('symbol_') || value.startsWith('pregnancy_') || ['deceased', 'stillborn', 'reference'].includes(value)) {
    return <g transform="translate(22 0) scale(.42)"><PersonSymbol reference={value === 'reference'} person={{ symbol: value.startsWith('symbol_') ? value.slice(7) : 'square', kind: value.startsWith('pregnancy_') ? 'pregnancy' : 'person', pregnancy_status: value.slice(10), vital_status: value }} /></g>;
  }
  if (value.startsWith('multiple_')) return <g fill="none" stroke="#202020"><path d="M 3 7 L 22 -7 L 42 7" />{value === 'multiple_identical' && <path d="M 12 0 H 32" />}</g>;
  return <g stroke="#202020"><path d="M 0 0 H 45" strokeDasharray={value.includes('adoptive') ? '8 4' : value.includes('foster') || value.includes('coparenting') ? '2 5' : value.includes('unknown') ? '8 3 2 3' : value.includes('cohabitation') || value.includes('partnership') ? '7 4' : undefined} />{value === 'status_separated' || value === 'status_divorced' ? <path d={`M 18 7 L 25 -7 ${value === 'status_divorced' ? 'M 25 7 L 32 -7' : ''}`} /> : null}</g>;
}

export function GenogramScene({ people, relations, layout, config, t, selected, search = '', title }: SceneProps) {
  const keys = legendKeys(people, relations, config);
  return <g fontFamily="Arial, sans-serif" fill="#202020">
    <text x={layout.minX + 25} y={layout.minY + 28} fontSize={18}>{title}</text>
    <text x={layout.minX + 25} y={layout.minY + 48} fontSize={10}>{new Date().toISOString().slice(0, 10)}</text>
    <FamilyLines config={config} people={people} relations={relations} positions={layout.positions} />
    {config.emotional && relations.filter(r => r.kind === 'emotional').map(r => {
      const a = layout.positions[r.source], b = layout.positions[r.target];
      if (!a || !b) return null;
      return <g key={r.id} data-relation={r.id} tabIndex={0} role="button" aria-label={t(`genograms.options.${r.emotion}`)}><path d={`M ${String(a.x + 25)} ${String(a.y - 28)} L ${String(b.x - 25)} ${String(b.y - 28)}`} fill="none" stroke="transparent" strokeWidth={14} /><EmotionStroke relation={r} x1={a.x + 25} y1={a.y - 28} x2={b.x - 25} y2={b.y - 28} /></g>;
    })}
    {people.map(person => {
      const point = layout.positions[person.id];
      if (!point) return null;
      const label = personLabel(person, config.labels), highlighted = Boolean(search && person.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
      return <g key={person.id} data-person={person.id} role="button" tabIndex={0} aria-label={label} transform={`translate(${String(point.x)} ${String(point.y)})`}>
        {(selected === person.id || highlighted) && <rect data-selection="true" x={-35} y={-35} width={70} height={90} rx={5} fill={highlighted ? '#fff2bd' : '#eef2f6'} stroke="#6b7280" strokeDasharray="3 3" />}
        <PersonSymbol person={person} reference={config.root_id === person.id} />
        <text y={43} textAnchor="middle" fontSize={12}><title>{label}</title>{label}</text>
        {config.age && person.kind !== 'pregnancy' && <text y={62} textAnchor="middle" fontSize={11}>{personAge(person)}</text>}
        {config.dates && <text y={78} textAnchor="middle" fontSize={10}>{[person.birth_date, person.death_date].filter(Boolean).join(' – ')}</text>}
      </g>;
    })}
    {config.legend && <g transform={`translate(${String(layout.minX + 25)} ${String(layout.minY + layout.height + 20)})`}>
      <text fontSize={12} fontWeight="bold">{t('genograms.legend')}</text>
      {keys.map((key, index) => <g key={key} transform={`translate(0 ${String(28 + index * 25)})`}><LegendSymbol value={key} /><text x={60} y={4} fontSize={11}>{t(`genograms.legend_items.${key}`)}</text></g>)}
      <text y={keys.length * 25 + 40} fontSize={9}>{t('genograms.legend_note')}</text>
    </g>}
  </g>;
}
