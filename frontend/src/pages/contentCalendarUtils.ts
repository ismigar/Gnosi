import type { ScheduledSocialPost } from '../shared/api/social';


function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}


export function localDateKey(date: Date): string {
  return [
    String(date.getFullYear()),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}


export function weekDaysFor(date: Date): Date[] {
  const startOfWeek = new Date(date);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1);
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(startOfWeek);
    day.setDate(day.getDate() + offset);
    return day;
  });
}


export function postsForLocalDay(
  posts: readonly ScheduledSocialPost[],
  day: Date,
): ScheduledSocialPost[] {
  const dayKey = localDateKey(day);
  return posts.filter(
    (post) => localDateKey(new Date(post.scheduled_time)) === dayKey,
  );
}


export function formatScheduledTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}


export function isLocalToday(day: Date, now = new Date()): boolean {
  return localDateKey(day) === localDateKey(now);
}
