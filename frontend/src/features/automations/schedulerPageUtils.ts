export function formatTaskInterval(
  minutes: number | null | undefined,
): string | null {
  if (minutes === null || minutes === undefined) return null;
  if (minutes < 1) return `${String(Math.round(minutes * 60))} s`;
  const hours = minutes / 60;
  if (
    Number.isInteger(hours)
    || Math.abs(hours - Math.round(hours * 4) / 4) < 0.001
  ) {
    const rounded = Math.round(hours * 4) / 4;
    return rounded === 1 ? '1 h' : `${String(rounded)} h`;
  }
  return `${String(minutes)} min`;
}


export function minutesToHours(
  minutes: number | null | undefined,
): string {
  if (minutes === null || minutes === undefined) return '';
  return String(Number.parseFloat((minutes / 60).toFixed(4)));
}


export function hoursToMinutes(hours: string | undefined): number | null {
  const parsed = Number.parseFloat(hours ?? '');
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return Number.parseFloat((parsed * 60).toFixed(4));
}
