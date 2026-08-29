import type { ReaderSource } from '../../shared/api/reader';
import type { ScheduledTask } from '../../shared/api/scheduler';


export type FeedManagerTab = 'sources' | 'add' | 'scheduler';


export interface FeedSourceGroups {
    readonly newsletters: ReaderSource[];
    readonly rss: ReaderSource[];
}


const READER_TASK_NAMES = new Set([
    'fetch_feeds',
    'fetch_newsletters',
    'generate_podcast',
]);


export function groupFeedSources(
    sources: readonly ReaderSource[],
): FeedSourceGroups {
    return {
        newsletters: sources.filter((source) => source.type === 'newsletter'),
        rss: sources.filter((source) => source.type === 'rss'),
    };
}


export function readerSchedulerTasks(
    tasks: readonly ScheduledTask[],
): ScheduledTask[] {
    return tasks.filter((task) => READER_TASK_NAMES.has(task.name));
}


export function taskInterval(intervalMinutes: number): string {
    if (intervalMinutes < 60) return `${String(intervalMinutes)} min`;
    return `${String(Math.round(intervalMinutes / 60))}h`;
}
