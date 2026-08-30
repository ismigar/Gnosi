import { describe, expect, it } from 'vitest';

import type { ReaderSource } from '../../../../shared/api/reader';
import type { ScheduledTask } from '../../../../shared/api/scheduler';
import {
    groupFeedSources,
    readerSchedulerTasks,
    taskInterval,
} from './feedManagerModel';


const sources: ReaderSource[] = [
    {
        category: 'Research',
        created_at: '2026-08-30T08:00:00Z',
        id: 1,
        name: 'Research feed',
        type: 'rss',
        url: 'https://example.test/feed.xml',
    },
    {
        category: null,
        created_at: '2026-08-30T08:00:00Z',
        id: 2,
        name: 'Daily letter',
        type: 'newsletter',
        url: 'reader@example.test',
    },
    {
        category: null,
        created_at: '2026-08-30T08:00:00Z',
        id: 3,
        name: 'Unsupported source',
        type: null,
        url: 'https://example.test/source',
    },
];


function task(name: string): ScheduledTask {
    return {
        description: name,
        enabled: true,
        interval_minutes: 60,
        name,
        status: 'idle',
    };
}


describe('feedManagerModel', () => {
    it('groups RSS and newsletter sources without changing their order', () => {
        const grouped = groupFeedSources(sources);

        expect(grouped.rss.map((source) => source.id)).toEqual([1]);
        expect(grouped.newsletters.map((source) => source.id)).toEqual([2]);
    });

    it('keeps only scheduler tasks owned by the reader', () => {
        expect(readerSchedulerTasks([
            task('fetch_feeds'),
            task('unrelated_cleanup'),
            task('fetch_newsletters'),
            task('generate_podcast'),
        ]).map((scheduledTask) => scheduledTask.name)).toEqual([
            'fetch_feeds',
            'fetch_newsletters',
            'generate_podcast',
        ]);
    });

    it('preserves minute and rounded-hour interval labels', () => {
        expect(taskInterval(45)).toBe('45 min');
        expect(taskInterval(90)).toBe('2h');
    });
});
