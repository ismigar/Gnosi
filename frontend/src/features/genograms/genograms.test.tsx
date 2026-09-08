import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import { layoutGenogram } from './layout';
import { DEFAULT_CONFIG, personAge, personLabel, type Person, type Relation } from './model';
import { GenogramScene } from './scene';
import { cleanSVG } from './export';

const person = (id: string, extra: Partial<Person> = {}): Person => ({ id, title: id, alias: '', kind: 'person', symbol: 'neutral', gender: '', birth_date: '', death_date: '', birth_approximate: false, death_approximate: false, vital_status: 'unknown', pregnancy_status: 'ongoing', pregnancy_date: '', multiple_group: '', multiple_type: 'unknown', notes: '', sources: [], tags: [], etag: '', ...extra });
const relation = (id: string, source: string, target: string, extra: Partial<Relation> = {}): Relation => ({ id, title: id, kind: 'parent', source, target, union_type: 'partnership', union_status: 'unknown', parentage: 'biological', emotion: 'close', union_id: '', start_date: '', separation_date: '', divorce_date: '', end_date: '', observed_date: '', informant: '', notes: '', sources: [], etag: '', ...extra });
const height = (positions: Record<string, { y: number }>, id: string) => { const p = positions[id]; if (!p) throw new Error('Missing position'); return p.y; };
const translate = ((key: string) => key) as TFunction;

describe('genogram layout and representation', () => {
  it('lays out shared ancestors once and leaves emotional bonds out of positioning', () => {
    const people = ['g', 'p', 'q', 'c'].map(id => person(id));
    const relations = [relation('gp', 'g', 'p'), relation('gq', 'g', 'q'), relation('pc', 'p', 'c'), relation('qc', 'q', 'c')];
    const base = layoutGenogram({ people, relations, config: DEFAULT_CONFIG });
    expect(Object.keys(base.positions)).toHaveLength(4);
    expect(height(base.positions, 'g')).toBeLessThan(height(base.positions, 'p'));
    expect(height(base.positions, 'p')).toBeLessThan(height(base.positions, 'c'));
    expect(layoutGenogram({ people: [...people].reverse(), relations: [...relations].reverse(), config: DEFAULT_CONFIG })).toEqual(base);
    expect(layoutGenogram({ people, relations: [...relations, relation('emotion', 'g', 'c', { kind: 'emotional' })], config: DEFAULT_CONFIG })).toEqual(base);
  });
  it('keeps parentage ranks for partners from different generations', () => {
    const people = ['a', 'b', 'c'].map(id => person(id));
    const relations = [relation('ab', 'a', 'b'), relation('bc', 'b', 'c'), relation('ac', 'a', 'c', { kind: 'union' })];
    const { positions } = layoutGenogram({ people, relations, config: DEFAULT_CONFIG });
    expect(height(positions, 'a')).toBeLessThan(height(positions, 'b'));
    expect(height(positions, 'b')).toBeLessThan(height(positions, 'c'));
  });
  it('preserves manual coordinates only in the configured view', () => {
    const people = [person('a')];
    const pinned = layoutGenogram({ people, relations: [], config: { ...DEFAULT_CONFIG, positions: { a: { x: -120, y: 500 } } } });
    expect(pinned.positions.a).toEqual({ x: -120, y: 500 });
    expect(layoutGenogram({ people, relations: [], config: DEFAULT_CONFIG }).positions.a).not.toEqual(pinned.positions.a);
  });
  it('does not turn missing dates into precise ages', () => {
    expect(personAge(person('a'))).toBe('');
    expect(personAge(person('a', { birth_date: '1980' }), new Date('2026-09-08'))).toBe('≈46');
    expect(personAge(person('a', { birth_date: '1980-12-20' }), new Date('2026-09-08'))).toBe('45');
    expect(personAge(person('a', { birth_date: '1980', vital_status: 'deceased' }))).toBe('');
    expect(personLabel(person('a', { title: 'Mercè Soler' }), 'initials')).toBe('M. S.');
  });
  it('renders pregnancy loss, twins and emotional conventions in monochrome', () => {
    const people = [person('a'), person('b', { kind: 'pregnancy', pregnancy_status: 'termination' }), person('c', { multiple_group: 'twins', multiple_type: 'identical' }), person('d', { multiple_group: 'twins', multiple_type: 'identical' })];
    const relations = [relation('ab', 'a', 'b'), relation('ac', 'a', 'c'), relation('ad', 'a', 'd'), relation('emotion', 'c', 'd', { kind: 'emotional', emotion: 'fused_conflict' })];
    const layout = layoutGenogram({ people, relations, config: DEFAULT_CONFIG });
    const markup = renderToStaticMarkup(<svg><GenogramScene people={people} relations={relations} layout={layout} config={DEFAULT_CONFIG} t={translate} title="Example" /></svg>);
    expect(markup).toContain('pregnancy_termination');
    expect(markup).toContain('multiple_identical');
    expect(markup).toContain('emotion_fused_conflict');
    expect(markup).toContain('M -24 0 H 24');
  });
  it('exports the full bounds without selection or private attributes', () => {
    const people = [person('a', { title: 'Private Full Name', alias: 'A' })];
    const layout = layoutGenogram({ people, relations: [], config: DEFAULT_CONFIG });
    const markup = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" data-bounds="0 0 800 900" viewBox="200 200 50 50"><GenogramScene people={people} relations={[]} layout={layout} config={{ ...DEFAULT_CONFIG, labels: 'alias' }} t={translate} title="Family" selected="a" /></svg>);
    const source = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
    const output = cleanSVG(source);
    expect(output.getAttribute('viewBox')).toBe('0 0 800 900');
    expect(output.outerHTML).not.toContain('Private Full Name');
    expect(output.outerHTML).not.toContain('data-person');
    expect(output.outerHTML).not.toContain('data-selection');
  });
  it('measures a deterministic 200-person, 500-relation fixture', () => {
    const people = Array.from({ length: 200 }, (_, i) => person(`p${String(i)}`));
    const relations = Array.from({ length: 199 }, (_, i) => relation(`r${String(i)}`, `p${String(Math.floor(i / 3))}`, `p${String(i + 1)}`));
    for (let i = 0; i < 301; i++) relations.push(relation(`e${String(i)}`, `p${String(i % 199)}`, `p${String((i + 31) % 200)}`, { kind: 'emotional' }));
    const started = performance.now();
    const result = layoutGenogram({ people, relations, config: DEFAULT_CONFIG });
    const duration = performance.now() - started;
    expect(Object.keys(result.positions)).toHaveLength(200);
    expect(new Set(Object.values(result.positions).map(p => `${String(p.x)},${String(p.y)}`)).size).toBe(200);
    expect(duration).toBeLessThan(1500);
  });
});
