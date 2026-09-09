import type { components } from '../../generated/openapi';
export type Person = components['schemas']['GenogramPerson'];
export type Relation = components['schemas']['GenogramRelation'];
export type Config = components['schemas']['GenogramConfig'];
export type Network = components['schemas']['GenogramGraphResponse'];
export type Position = { x: number; y: number };
export const PEOPLE_TABLE_ID = '6dd838bb-de65-5901-87ab-0a0a37390b92';
export const DEFAULT_CONFIG: Config = { version: 1, root_id: '', ancestors: 2, descendants: 1, include_ids: [], exclude_ids: [], emotional: true, legend: true, age: true, dates: false, labels: 'name', positions: {} };
export function configValue(value: unknown): Config {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...value };
}
export function personLabel(person: Person, mode: Config['labels']): string {
  if (mode === 'name') return person.title;
  if (mode === 'alias' && person.alias) return person.alias;
  return person.title.split(/\s+/u).filter(Boolean).map(part => `${Array.from(part)[0] ?? ''}.`).join(' ');
}
export function personAge(person: Person, today = new Date()): string {
  const birth = person.birth_date;
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(birth)) return '';
  const end = person.vital_status === 'deceased' || person.vital_status === 'stillborn' ? person.death_date : today.toISOString().slice(0, 10);
  if (!end || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(end)) return '';
  const valid = (value: string) => {
    const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= ([31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0);
  };
  if (!valid(birth) || !valid(end)) return '';
  const a = birth.split('-').map(Number), b = end.split('-').map(Number);
  const [ay = 0, am = 1, ad = 1] = a, [by = 0, bm = 1, bd = 1] = b;
  let age = by - ay;
  const exact = a.length === 3 && b.length === 3;
  if (a.length >= 2 && b.length >= 2 && (bm < am || (exact && bm === am && bd < ad))) age--;
  if (age < 0) return '';
  return `${exact && !person.birth_approximate && !person.death_approximate ? '' : '≈'}${String(age)}`;
}
export const PERSON_OPTIONS: Record<string, readonly string[]> = {
  kind: ['person', 'pregnancy'], symbol: ['square', 'circle', 'neutral'],
  vital_status: ['unknown', 'alive', 'deceased', 'stillborn'], pregnancy_status: ['ongoing', 'miscarriage', 'termination'],
  multiple_type: ['unknown', 'fraternal', 'identical'],
};
export const RELATION_OPTIONS: Record<string, readonly string[]> = {
  kind: ['union', 'parent', 'emotional'], union_type: ['marriage', 'cohabitation', 'partnership', 'coparenting'],
  union_status: ['unknown', 'active', 'separated', 'divorced', 'ended'], parentage: ['biological', 'adoptive', 'foster', 'unknown'],
  emotion: ['close', 'fused', 'distant', 'cutoff', 'conflict', 'close_conflict', 'distant_conflict', 'fused_conflict'],
};

export function boxNumbers(value: string): [number, number, number, number] {
  const [x = 0, y = 0, width = 800, height = 600] = value.split(' ').map(Number);
  return [x, y, width, height];
}

export function personOptionLabel(person: Person, people: Person[]): string {
  return people.filter(p => p.title === person.title).length > 1 ? `${person.title} (${person.birth_date || person.alias || person.id.slice(0, 8)})` : person.title;
}
