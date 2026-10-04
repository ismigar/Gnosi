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
            if (!criterion || !Number.isFinite(age) || age < 0 || age > stored.suite.max_age_days * 86400000
                || !['', 'contract_mismatch'].includes(item.failure)) continue;
            const previous = selected.get(item.id);
            if (!previous || Date.parse(previous.checked_at) < Date.parse(item.checked_at)) selected.set(item.id, item);
        }
    }
    const cases = [...selected.values()];
    const complete = criteria.length > 0 && cases.length === criteria.length;
    return { cases, expected: criteria.length, complete, failed: cases.some(item => !item.passed),
        tasks: tasks.map(task => {
            const required = criteria.filter(criterion => criterion.tasks.includes(task));
            const measured = required.flatMap(criterion => selected.get(criterion.id) ?? []);
            return { task, passed: measured.filter(item => item.passed).length, measured: measured.length, total: required.length };
        }) };
}
