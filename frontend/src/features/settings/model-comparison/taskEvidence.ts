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
            if (!previous || Date.parse(previous.checked_at) < Date.parse(item.checked_at)
                || (previous.checked_at === item.checked_at && (previous.reviewed_at || '') < (item.reviewed_at || ''))) selected.set(item.id, item);
        }
    }
    const cases = [...selected.values()];
    const accepted = (item: typeof cases[number]) => item.passed && (!item.requires_review || item.review === 'accepted');
    const complete = criteria.length > 0 && cases.length === criteria.length && cases.every(accepted);
    return { cases, expected: criteria.length, complete,
        stale: cases.some(item => now - Date.parse(item.checked_at) > (stored?.suite.max_age_days ?? 30) * 86400000),
        failed: cases.some(item => !item.passed || item.review === 'rejected'),
        tasks: tasks.map(task => {
            const required = criteria.filter(criterion => criterion.tasks.includes(task));
            const measured = required.flatMap(criterion => selected.get(criterion.id) ?? []);
            return { task, passed: measured.filter(accepted).length, measured: measured.length, total: required.length };
        }) };
}
