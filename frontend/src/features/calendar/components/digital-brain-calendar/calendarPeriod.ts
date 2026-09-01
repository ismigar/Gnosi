import type { PeriodInput } from '../../../../shared/dates/projectPlanning';

type PeriodScalar = Exclude<PeriodInput, object>;

function isCalendarRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function calendarRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return isCalendarRecord(value) ? value : null;
}

export function calendarScalar(value: unknown): PeriodScalar {
  return value === null || value === undefined || typeof value === 'string'
    || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
    ? value : undefined;
}

export function calendarText(value: unknown): string {
  const scalar = calendarScalar(value);
  return scalar === null || scalar === undefined ? '' : String(scalar);
}

export function calendarPeriodInput(value: unknown): PeriodInput {
  if (value instanceof Date) return value;
  const source = calendarRecord(value);
  if (!source) return calendarScalar(value);
  return {
    actualEnd: calendarScalar(source.actualEnd), actualStart: calendarScalar(source.actualStart),
    constraintDate: calendarScalar(source.constraintDate), constraintType: calendarScalar(source.constraintType),
    deadline: calendarScalar(source.deadline), durationDays: calendarScalar(source.durationDays),
    durationUnit: calendarScalar(source.durationUnit), durationValue: calendarScalar(source.durationValue),
    end: calendarScalar(source.end), endMode: calendarScalar(source.endMode), mode: calendarScalar(source.mode),
    percentComplete: calendarScalar(source.percentComplete), start: calendarScalar(source.start),
    startMode: calendarScalar(source.startMode),
    predecessorIds: Array.isArray(source.predecessorIds)
      ? source.predecessorIds.map(calendarScalar) : calendarScalar(source.predecessorIds),
    dependencies: Array.isArray(source.dependencies) ? source.dependencies.flatMap((value: unknown) => {
      const dependency = calendarRecord(value);
      return dependency ? [{
        lagMinutes: calendarScalar(dependency.lagMinutes),
        predecessorId: calendarScalar(dependency.predecessorId),
        type: calendarScalar(dependency.type),
      }] : [];
    }) : undefined,
  };
}

export function isCalendarPeriod(value: unknown): boolean {
  return Boolean(value && typeof value === 'object') || calendarText(value).includes('/');
}
