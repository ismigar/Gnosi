import { expect, it } from 'vitest';
import { taskEvidence } from './taskEvidence';
import { checked, now, suite } from './__fixtures__/taskEvidence';

it('retains dated evidence without forcing calls, flags age and rejects a different suite', () => {
    const report = checked();
    const first = report.cases?.[0];
    if (!first) throw new Error('Missing case');
    report.cases = [{ ...first, checked_at: '2026-08-01T00:00:00Z' }];
    const stored = { reports: [report], suite };
    expect(taskEvidence(stored, 'p', 'near', ['book'], now)).toMatchObject({ complete: true, current: false, stale: true });
    expect(taskEvidence({ ...stored, suite: { ...suite, version: 'different' } }, 'p', 'near', ['book'], now).complete).toBe(false);
});

it('cannot certify a profile if its suite has no criteria for one of its duties', () => {
    const stored = { suite, reports: [checked()] };
    expect(taskEvidence(stored, 'p', 'near', ['book', 'code'], now))
        .toMatchObject({ complete: false, current: false, failed: false });
});

it('enforces the suite review requirement even if the saved row omits it', () => {
    const reviewedSuite = { ...suite, criteria: suite.criteria.map(item => ({ ...item, requires_review: true })) };
    const report = checked();
    expect(taskEvidence({ suite: reviewedSuite, reports: [report] }, 'p', 'near', ['book'], now).current).toBe(false);
    report.cases = report.cases?.map(item => ({ ...item, review: 'accepted' }));
    expect(taskEvidence({ suite: reviewedSuite, reports: [report] }, 'p', 'near', ['book'], now).current).toBe(true);
});

it('requires human acceptance of open-ended work and reuses the latest review', () => {
    const report = checked();
    const first = report.cases?.[0];
    if (!first) throw new Error('Missing case');
    report.cases = [{ ...first, requires_review: true, review: 'pending' }];
    const evidence = () => taskEvidence({ reports: [report], suite }, 'p', 'near', ['book'], now);
    expect(evidence()).toMatchObject({ complete: false, failed: false });
    report.cases[0] = { ...first, requires_review: true, review: 'accepted' };
    expect(evidence().complete).toBe(true);
    report.cases[0] = { ...first, requires_review: true, review: 'rejected' };
    expect(evidence()).toMatchObject({ complete: false, failed: true });
});

it('reuses the criterion across bots without borrowing failures from other functions', () => {
    const stored = { suite, reports: [checked()] };
    expect(taskEvidence(stored, 'p', 'near', ['book'], now)).toMatchObject({ complete: true, failed: false, expected: 1 });
    expect(taskEvidence(stored, 'p', 'near', ['translate'], now).failed).toBe(true);
});

it('requires matching exact provider, model, suite version and inference settings', () => {
    for (const report of [checked({ provider: 'other' }), checked({ model: 'other' }), checked({ version: 'old' }), checked({ mode: 'high' })]) {
        expect(taskEvidence({ suite, reports: [report] }, 'p', 'near', ['book'], now).cases).toEqual([]);
    }
});

it('requires all criteria and uses the newest result without counting duplicates', () => {
    const report = checked(); const first = report.cases?.[0];
    if (!first) throw new Error('Missing fixture');
    const newer = checked({ cases: [{ ...first, checked_at: '2026-10-04T13:00:00Z', passed: false, failure: 'contract_mismatch' }] });
    expect(taskEvidence({ suite, reports: [report, newer, report] }, 'p', 'near', ['book', 'translate'], now))
        .toMatchObject({ complete: false, failed: true, expected: 2 });
});

it('connection errors remain inconclusive rather than quality failures', () => {
    const report = checked({ cases: checked().cases?.map(item => ({ ...item, passed: false, failure: 'TimeoutError' })) });
    expect(taskEvidence({ suite, reports: [report] }, 'p', 'near', ['book'], now)).toMatchObject({ complete: false, failed: false });
});
it('keeps local evidence ahead of newer shared observations', () => {
    const local = checked();
    const community = checked({ id: 'shared', cases: local.cases?.map(item => ({ ...item, passed: true, failure: '',
        evidence_origin: 'shared', observations: 2, contributors: 2, checked_at: '2026-10-04T18:00:00Z' })) });
    for (const reports of [[community, local], [local, community]]) {
        const result = taskEvidence({ suite, reports }, 'p', 'near', ['translate'], now);
        expect(result.failed).toBe(true);
        expect(result.cases[0]?.evidence_origin).toBe('local');
    }
});
