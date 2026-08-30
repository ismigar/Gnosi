import type { ComponentProps } from 'react';
import type { AutomationsSettingsPanel, OperationsHistoryPanel } from '../AI/AIOperationsSettings';
import type { useAIResources } from '../AI/useAIResources';
import { isJsonRecord, type JsonRecord } from '../AI/aiResourcesApi';

type Resources = ReturnType<typeof useAIResources>;
type Automations = ComponentProps<typeof AutomationsSettingsPanel>['resources'];
type Operations = ComponentProps<typeof OperationsHistoryPanel>['resources'];
type Automation = Automations['automations'][number];
type Approval = Operations['approvals'][number];
type Job = Operations['jobs'][number];
type AuditEvent = Operations['auditEvents'][number];
const numeric = (value: unknown) => typeof value === 'number' || typeof value === 'string';
const nullableString = (value: unknown) => value == null || typeof value === 'string';
const budgetKeys = ['max_runs_per_day', 'max_ai_calls_per_run', 'max_runtime_seconds'];
const budgets = (value: JsonRecord) => budgetKeys.every(key => value[key] === undefined || numeric(value[key]));

function isAutomation(value: JsonRecord): value is JsonRecord & Automation {
    return ['id', 'name', 'agent_id', 'skill_id', 'instruction'].every(key => typeof value[key] === 'string')
        && typeof value.enabled === 'boolean' && numeric(value.interval_minutes)
        && nullableString(value.last_status) && (value.revision == null || numeric(value.revision))
        && budgets(value) && (value.budgets === undefined || (isJsonRecord(value.budgets) && budgets(value.budgets)));
}
function isApproval(value: JsonRecord): value is JsonRecord & Approval {
    return ['agent_id', 'confirmation_id', 'session_id'].every(key => typeof value[key] === 'string')
        && (value.details == null || (isJsonRecord(value.details) && nullableString(value.details.tool)));
}
function isJob(value: JsonRecord): value is JsonRecord & Job {
    return typeof value.job_id === 'string' && nullableString(value.provider) && nullableString(value.status);
}
function isAuditEvent(value: JsonRecord): value is JsonRecord & AuditEvent {
    return ['id', 'agent_id', 'tool_name'].every(key => typeof value[key] === 'string')
        && typeof value.created_at === 'number' && typeof value.duration_ms === 'number' && nullableString(value.status);
}
function rows<T>(values: JsonRecord[], predicate: (value: JsonRecord) => value is JsonRecord & T, kind: string): (JsonRecord & T)[] {
    if (!values.every(predicate)) throw new TypeError(`Invalid AI ${kind} response`);
    return values;
}

/** Validate consumers' contracts without dropping rows, extension keys or callbacks. */
export function automationResources(resources: Pick<Resources, 'automations' | 'skills' | 'loading' | 'saveAutomation' | 'deleteAutomation' | 'runAutomation'>): Automations {
    return {
        ...resources,
        automations: rows(resources.automations, isAutomation, 'automations'),
        saveAutomation: draft => resources.saveAutomation({ ...draft }),
    };
}
export function operationResources(resources: Pick<Resources, 'approvals' | 'jobs' | 'auditEvents' | 'tools' | 'resolveApproval'>): Operations {
    return {
        ...resources,
        approvals: rows(resources.approvals, isApproval, 'approvals'),
        jobs: rows(resources.jobs, isJob, 'jobs'),
        auditEvents: rows(resources.auditEvents, isAuditEvent, 'audit events'),
        resolveApproval: (approval, decision) => resources.resolveApproval({ ...approval }, decision),
    };
}
