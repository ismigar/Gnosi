import { asBool } from '../../utils/vaultFilters';

type RollupValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

type PresentRollupValue = Exclude<RollupValue, null | undefined>;

function parseNumericValue(value: RollupValue): number {
  const text = String(value).trim();
  return /^-?\d+,\d+$/.test(text)
    ? Number(text.replace(',', '.'))
    : Number.parseFloat(text);
}

/** Computes one aggregation over related Vault values. */
export function evaluateRollup(
  values: readonly RollupValue[] = [],
  aggregation = 'count_all',
): PresentRollupValue | null {
  const numericValues = values
    .map(parseNumericValue)
    .filter((value) => !Number.isNaN(value));
  const nonEmptyValues = values.filter(
    (value): value is PresentRollupValue =>
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
      return nonEmptyValues.length
        ? (nonEmptyValues.sort().at(0) ?? null)
        : null;
    case 'latest':
      return nonEmptyValues.length
        ? (nonEmptyValues.sort().reverse().at(0) ?? null)
        : null;
    case 'show_original':
      return nonEmptyValues.join(', ');
    default:
      return values.length;
  }
}
