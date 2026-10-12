import { asBool } from '../../../shared/filtering/vaultFilters';
import { periodBoundary } from '../../../shared/dates/projectPlanning';

function parseNumericValue(value: unknown): number {
  const text = String(value).trim();
  return /^-?\d+,\d+$/.test(text)
    ? Number(text.replace(',', '.'))
    : Number.parseFloat(text);
}

/** Computes one aggregation over related Vault values. */
export function evaluateRollup<Value>(
  values: readonly Value[] = [],
  aggregation = 'count_all',
): NonNullable<Value> | number | string | null {
  const numericValues = values
    .map(parseNumericValue)
    .filter((value) => !Number.isNaN(value));
  const nonEmptyValues = values.filter(
    (value): value is NonNullable<Value> =>
      value !== null && value !== undefined && value !== '',
  );

  switch (aggregation) {
    case 'count_all':
      return values.length;
    case 'count_values':
      return nonEmptyValues.length;
    case 'sum':
      return numericValues.reduce((left, right) => left + right, 0);
    case 'avg':
      return numericValues.length
        ? (
            numericValues.reduce((left, right) => left + right, 0) /
            numericValues.length
          ).toFixed(2)
        : 0;
    case 'min':
      return numericValues.length ? Math.min(...numericValues) : null;
    case 'max':
      return numericValues.length ? Math.max(...numericValues) : null;
    case 'unique_count':
      return new Set(nonEmptyValues.map((value) => String(value))).size;
    case 'percent_checked': {
      if (!values.length) return '0%';
      const checked = values.filter((value) => asBool(value)).length;
      return `${String(Math.round((checked / values.length) * 100))}%`;
    }
    case 'earliest':
    case 'latest':
      { const dates = nonEmptyValues.map(value => typeof value === 'object' && 'start' in value
          ? periodBoundary(value, aggregation === 'latest' ? 'end' : 'start') : value);
        dates.sort();
        return (aggregation === 'latest' ? dates.at(-1) : dates.at(0)) ?? null;
      }
    case 'show_original':
      return nonEmptyValues.join(', ');
    default:
      return values.length;
  }
}
