import type { Person, Relation } from './model';

export function PersonSymbol({ person, reference = false }: { person: Pick<Person, 'kind' | 'symbol' | 'vital_status' | 'pregnancy_status'>; reference?: boolean }) {
  const size = person.vital_status === 'stillborn' ? 12 : 20;
  const shape = (extra: number) => person.kind === 'pregnancy'
    ? <path d={`M 0 ${String(-size - extra)} L ${String(size + extra)} ${String(size + extra)} L ${String(-size - extra)} ${String(size + extra)} Z`} />
    : person.symbol === 'square' ? <rect x={-size - extra} y={-size - extra} width={(size + extra) * 2} height={(size + extra) * 2} />
    : person.symbol === 'circle' ? <circle r={size + extra} />
    : <path d={`M 0 ${String(-size - extra)} L ${String(size + extra)} 0 L 0 ${String(size + extra)} L ${String(-size - extra)} 0 Z`} />;
  const crossed = person.vital_status === 'deceased' || person.vital_status === 'stillborn' || (person.kind === 'pregnancy' && person.pregnancy_status !== 'ongoing');
  return <g fill="white" stroke="#202020" strokeWidth={1.6}>
    {reference && shape(5)}{shape(0)}
    {crossed && <path d="M -23 -23 L 23 23 M -23 23 L 23 -23" />}
    {person.kind === 'pregnancy' && person.pregnancy_status === 'termination' && <path d="M -24 0 H 24" />}
    {person.symbol === 'neutral' && person.kind !== 'pregnancy' && <text y={5} textAnchor="middle" stroke="none" fill="#202020" fontSize={14}>?</text>}
  </g>;
}

export function EmotionStroke({ relation, x1, y1, x2, y2 }: { relation: Pick<Relation, 'emotion'>; x1: number; y1: number; x2: number; y2: number }) {
  const emotion = relation.emotion;
  const dx = x2 - x1, dy = y2 - y1, length = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / length, ny = dx / length;
  const line = (offset: number, dash?: string) => <path key={offset} d={`M ${String(x1 + nx * offset)} ${String(y1 + ny * offset)} L ${String(x2 + nx * offset)} ${String(y2 + ny * offset)}`} strokeDasharray={dash} />;
  let zigzag = `M ${String(x1)} ${String(y1)}`;
  const steps = Math.max(4, Math.ceil(length / 9));
  for (let i = 1; i <= steps; i++) {
    const offset = i === steps ? 0 : i % 2 ? 4 : -4;
    zigzag += ` L ${String(x1 + dx * i / steps + nx * offset)} ${String(y1 + dy * i / steps + ny * offset)}`;
  }
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return <g fill="none" stroke="#555" strokeWidth={1.4}>
    {emotion.includes('fused') ? [-5, 0, 5].map(offset => line(offset)) : emotion.includes('close') ? [-3, 3].map(offset => line(offset)) : emotion.includes('distant') ? line(0, '4 6') : emotion !== 'conflict' ? line(0) : null}
    {emotion.includes('conflict') && <path d={zigzag} />}
    {emotion === 'cutoff' && <><path d={`M ${String(mx - dx / length * 9)} ${String(my - dy / length * 9)} L ${String(mx + dx / length * 9)} ${String(my + dy / length * 9)}`} stroke="white" strokeWidth={6} />{[-8, 8].map(offset => <path key={offset} d={`M ${String(mx + dx / length * offset - nx * 8)} ${String(my + dy / length * offset - ny * 8)} l ${String(nx * 16)} ${String(ny * 16)}`} />)}</>}
  </g>;
}
