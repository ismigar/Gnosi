import { describe, expect, it } from 'vitest';

import type {
    ResourceProcessingJob,
    ResourceProcessingStart,
} from '../../../shared/api/resource-processing';
import {
    countTouchedPages,
    getPollingIdentifier,
    getProcessPhase,
    getProgressPercent,
    getStartErrorMessage,
    getTerminalProcessState,
} from './processResourceModel';


const baseJob: ResourceProcessingJob = {
    phase: 'reading',
    resource_id: 'note-1',
    running: true,
};


function startResponse(jobId: string | null): ResourceProcessingStart {
    return {
        item_id: 'note-1',
        job: baseJob,
        job_id: jobId,
        resource_id: 'note-1',
        source_table_id: 'resources',
        status: 'started',
    };
}


describe('processResourceModel', () => {
    it('normalizes known and unknown phases for presentation', () => {
        expect(getProcessPhase({ ...baseJob, phase: 'writing' })).toEqual({
            defaultLabel: 'Writing to the Brain…',
            key: 'writing',
        });
        expect(getProcessPhase({ ...baseJob, phase: 'vendor-step' })).toEqual({
            defaultLabel: 'Reading the source…',
            key: 'reading',
        });
        expect(getProcessPhase(null)).toEqual({
            defaultLabel: 'Reading the source…',
            key: 'reading',
        });
    });


    it('counts touched pages across nullable generated collections', () => {
        expect(countTouchedPages({
            ...baseJob,
            created: ['One', 'Two'],
            updated: ['Three'],
        })).toBe(3);
        expect(countTouchedPages({
            ...baseJob,
            created: null,
            updated: null,
        })).toBe(0);
        expect(countTouchedPages(null)).toBe(0);
    });


    it('accepts only finite progress and clamps it for CSS', () => {
        expect(getProgressPercent({ ...baseJob, progress: -4 })).toBe(0);
        expect(getProgressPercent({ ...baseJob, progress: 61.5 })).toBe(61.5);
        expect(getProgressPercent({ ...baseJob, progress: 140 })).toBe(100);
        expect(getProgressPercent({ ...baseJob, progress: Number.NaN })).toBeNull();
        expect(getProgressPercent({ ...baseJob, progress: null })).toBeNull();
    });


    it('recognizes only settled terminal phases', () => {
        expect(getTerminalProcessState({
            ...baseJob,
            phase: 'done',
            running: true,
        })).toBeNull();
        expect(getTerminalProcessState({
            ...baseJob,
            phase: 'done',
            running: false,
        })).toBe('done');
        expect(getTerminalProcessState({
            ...baseJob,
            phase: 'partial',
            running: null,
        })).toBe('error');
        expect(getTerminalProcessState({
            ...baseJob,
            phase: 'writing',
            running: false,
        })).toBeNull();
    });


    it('falls back to the resource identifier when no job id is returned', () => {
        expect(getPollingIdentifier(startResponse('job-1'), 'note-1')).toBe(
            'job-1',
        );
        expect(getPollingIdentifier(startResponse(null), 'note-1')).toBe(
            'note-1',
        );
    });


    it('maps the known configuration error and preserves useful details', () => {
        expect(getStartErrorMessage(
            new Error('No Brain table is configured'),
            'Configure the Brain table',
            'Generic failure',
        )).toBe('Configure the Brain table');
        expect(getStartErrorMessage(
            new Error('Provider unavailable'),
            'Configure the Brain table',
            'Generic failure',
        )).toBe('Provider unavailable');
        expect(getStartErrorMessage(
            { reason: 'opaque' },
            'Configure the Brain table',
            'Generic failure',
        )).toBe('Generic failure');
    });
});
