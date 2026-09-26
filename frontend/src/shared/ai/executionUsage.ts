import type { AgentExecutionRun } from '../api/ai-activity';

/** Usage belongs to model call records; job counters already contain their children. */
export function executionUsage(run: AgentExecutionRun, runs: readonly AgentExecutionRun[]) {
    const selected: AgentExecutionRun[] = [];
    const visited = new Set<string>();
    const collect = (item: AgentExecutionRun) => {
        if (visited.has(item.run_id)) return;
        visited.add(item.run_id);
        const children = runs.filter(r => r.parent_run_id === item.run_id);
        if (!children.length || item.model) selected.push(item);
        children.forEach(collect);
    };
    collect(run);
    return {
        calls: selected.reduce((n, item) => n + item.model_calls, 0),
        input: selected.reduce((n, item) => n + item.input_tokens, 0),
        output: selected.reduce((n, item) => n + item.output_tokens, 0),
        available: selected.some(item => item.usage_available) && selected.every(item => !item.model_calls || item.usage_available),
    };
}
