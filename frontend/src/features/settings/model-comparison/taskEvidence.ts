import type { TaskEvaluationReport, TaskEvaluationSuite } from '../../../shared/api/ai-activity';
import type { TaskId } from './taskRecommendations';

export interface StoredTaskEvidence {
    reports: readonly TaskEvaluationReport[];
    suite: TaskEvaluationSuite;
}

/** Same fixture/route/mode, across bots; old role scores never certify a task. */
export function taskEvidence(stored: StoredTaskEvidence | undefined, provider: string, model: string,
    tasks: readonly TaskId[], now: number) {
    const criteria = stored?.suite.criteria.filter(criterion => criterion.tasks.some(task => tasks.includes(task))) ?? [];
    const selected = new Map<string, NonNullable<TaskEvaluationReport['cases']>[number]>();
    for (const report of stored?.reports ?? []) {
        if (report.provider !== provider || report.model !== model || report.version !== stored?.suite.version
            || report.mode !== stored.suite.mode) continue;
        for (const item of report.cases ?? []) {
            const age = now - Date.parse(item.checked_at);
            const criterion = criteria.find(criterion => criterion.id === item.id && criterion.metric === item.metric);
            if (!criterion || !Number.isFinite(age) || age < 0
                || !['', 'contract_mismatch'].includes(item.failure)) continue;
            const previous = selected.get(item.id);
            const sameOrigin = (previous?.evidence_origin === 'shared') === (item.evidence_origin === 'shared');
            const newer = !previous || Date.parse(previous.checked_at) < Date.parse(item.checked_at)
                || (previous.checked_at === item.checked_at && (previous.reviewed_at || '') < (item.reviewed_at || ''));
            if (!previous || (previous.evidence_origin === 'shared' && item.evidence_origin !== 'shared')
                || (sameOrigin && newer)) selected.set(item.id, item);
        }
    }
    const cases = [...selected.values()];
    // The suite owns review requirements, not a potentially incomplete saved row.
    const accepted = (item: typeof cases[number]) => item.passed && item.review !== 'rejected'
        && (!(item.requires_review || criteria.find(criterion => criterion.id === item.id)?.requires_review) || item.review === 'accepted');
    const covered = tasks.length > 0 && tasks.every(task => criteria.some(criterion => criterion.tasks.includes(task)));
    const complete = covered && criteria.length > 0 && cases.length === criteria.length && cases.every(accepted);
    const stale = cases.some(item => now - Date.parse(item.checked_at) > (stored?.suite.max_age_days ?? 30) * 86400000);
    return { cases, expected: criteria.length, complete, current: complete && !stale, stale,
        failed: cases.some(item => !item.passed || item.review === 'rejected'),
        tasks: tasks.map(task => {
            const required = criteria.filter(criterion => criterion.tasks.includes(task));
            const measured = required.flatMap(criterion => selected.get(criterion.id) ?? []);
            return { task, passed: measured.filter(accepted).length, measured: measured.length, total: required.length };
        }) };
}
