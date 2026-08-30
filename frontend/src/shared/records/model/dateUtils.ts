type VaultDateValue = Date | string | number | null | undefined;

interface FormatVaultDateOptions {
  withTime?: boolean;
}

const DATE_RE = /^(?<year>-?\d{4,})-(?<month>\d{2})-(?<day>\d{2})(?:T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?)?$/;

const pad = (value: number): string =>
  String(Math.abs(value)).padStart(2, '0');

/** Parse signed ISO dates in local time, including years before 1 CE. */
export function parseVaultDate(value?: VaultDateValue): Date {
  if (value instanceof Date) return new Date(value.getTime());
  const text = String(value ?? '').trim();
  const match = text.match(DATE_RE);
  if (!match?.groups) {
    if (value === null) return new Date(0);
    if (value === undefined) return new Date(Number.NaN);
    return new Date(value);
  }
  const {
    year,
    month,
    day,
    hour = '0',
    minute = '0',
    second = '0',
  } = match.groups;
  const date = new Date(0);
  date.setFullYear(Number(year), Number(month) - 1, Number(day));
  date.setHours(Number(hour), Number(minute), Number(second), 0);
  return date;
}

export function isSignedVaultDate(value?: VaultDateValue): boolean {
  return /^-\d{4,}-\d{2}-\d{2}/.test(String(value ?? '').trim());
}

export function formatVaultDate(
  value?: VaultDateValue,
  { withTime = false }: FormatVaultDateOptions = {},
): string {
  const date = parseVaultDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const signedYear =
    year < 0
      ? `-${String(Math.abs(year)).padStart(4, '0')}`
      : String(year).padStart(4, '0');
  const day = `${signedYear}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime
    ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    : day;
}
