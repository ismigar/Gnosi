import { describe, expect, it } from 'vitest';

import {
    nextOlderHistoryVersion,
    pageHistoryDiffLines,
    pageHistoryDiffSummary,
} from './pageHistoryModel';


describe('pageHistoryModel', () => {
    it('counts unique added and removed non-empty lines', () => {
        expect(pageHistoryDiffSummary('alpha\nbeta', 'beta\ngamma')).toEqual({
            added: 1,
            removed: 1,
        });
    });

    it('keeps removed lines before the current annotated content', () => {
        expect(pageHistoryDiffLines('alpha\nbeta', 'beta\ngamma')).toEqual([
            { kind: 'removed', line: 'alpha' },
            { kind: 'unchanged', line: 'beta' },
            { kind: 'added', line: 'gamma' },
        ]);
    });

    it('finds the next older version without wrapping', () => {
        const versions = [
            { author: 'A', id: 'new', size: 10, timestamp: '2026-08-29' },
            { author: 'A', id: 'old', size: 8, timestamp: '2026-08-28' },
        ];
        expect(nextOlderHistoryVersion(versions, 'new')?.id).toBe('old');
        expect(nextOlderHistoryVersion(versions, 'old')).toBeNull();
        expect(nextOlderHistoryVersion(versions, 'missing')).toBeNull();
    });
});
