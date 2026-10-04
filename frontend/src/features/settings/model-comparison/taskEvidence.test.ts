import { expect, it } from 'vitest';
import { taskEvidence } from './taskEvidence';

import { now, suite, checked } from './__fixtures__/taskEvidence';
it('reuses the criterion across bots, without borrowing failures from other functions', () => {
    const stored = { suite, reports: [checked()] };
    expect(taskEvidence(stored, 'p', 'near', ['book'], now)).toMatchObject({ complete: true, failed: false, expected: 1 });
    expect(taskEvidence(stored, 'p', 'near', ['translate'], now).failed).toBe(true);
});
it('requires matching exact provider, model, suite version and diagnostic settings', () => {
    for (const report of [checked({ provider: 'other' }), checked({ model: 'other' }), checked({ version: 'old' }), checked({ mode: 'high' })]) {
        expect(taskEvidence({ suite, reports: [report] }, 'p', 'near', ['book'], now).cases).toEqual([]);
    }
});
it('uses case age, never a fresh report date from copying an old result', () => {
    const report = checked({ cases: checked().cases?.map(item => ({ ...item, checked_at: '2026-08-01T00:00:00Z', reused_from: 'old' })) });
    expect(taskEvidence({ suite, reports: [report] }, 'p', 'near', ['book'], now).complete).toBe(false);
});
it('requires every criterion and prefers the newest result without counting duplicates', () => {
    const report = checked();
    const first = report.cases?.[0];
    if (!first) throw new Error('Missing fixture');
    const newer = checked({ cases: [{ ...first, checked_at: '2026-10-04T13:00:00Z', passed: false, failure: 'contract_mismatch' }] });
    expect(taskEvidence({ suite, reports: [report, newer, report] }, 'p', 'near', ['book', 'translate'], now))
        .toMatchObject({ complete: true, failed: true, expected: 2 });
});
it('connection errors are not scored as quality failures', () => {
    const report = checked({ cases: checked().cases?.map(item => ({ ...item, passed: false, failure: 'TimeoutError' })) });
    expect(taskEvidence({ suite, reports: [report] }, 'p', 'near', ['book'], now)).toMatchObject({ complete: false, failed: false });
});
