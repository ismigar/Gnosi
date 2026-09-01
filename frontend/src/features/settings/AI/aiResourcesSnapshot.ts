import {
    catalogRows,
    normalizeSkill,
    normalizeTool,
    type NormalizedSkill,
    type NormalizedTool,
    type RawCatalogRecord,
} from './aiSettingsUtils';
import {
    isJsonRecord,
    jsonRecords,
    requestAIResource,
    type JsonRecord,
} from './aiResourcesApi';


export interface AIResourceSnapshot {
    approvals: JsonRecord[];
    auditEvents: JsonRecord[];
    automations: JsonRecord[];
    capabilityConformance: JsonRecord | null;
    issues: JsonRecord[];
    jobs: JsonRecord[];
    modelEvaluations: JsonRecord[];
    qualityDashboard: JsonRecord | null;
    semanticAssociations: JsonRecord[];
    skills: NormalizedSkill[];
    tools: NormalizedTool[];
}


const catalogRecord = (value: unknown): RawCatalogRecord => (
    isJsonRecord(value) ? value : {}
);


export const optionalRecord = (value: unknown): JsonRecord | null => (
    isJsonRecord(value) ? value : null
);


export const mutationCatalogRecord = (payload: unknown): RawCatalogRecord => {
    if (!isJsonRecord(payload)) return {};
    return catalogRecord(payload.skill ?? payload);
};


export const stringArray = (
    value: unknown,
    fallback: readonly string[] = [],
): string[] => (
    Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [...fallback]
);


export const loadAIResourceSnapshot = async (): Promise<AIResourceSnapshot> => {
    const [
        skillsPayload,
        toolsPayload,
        automationsPayload,
        jobsPayload,
        auditPayload,
        approvalsPayload,
        qualityPayload,
        associationsPayload,
        conformancePayload,
        evaluationsPayload,
    ] = await Promise.all([
        requestAIResource('/api/ai/skills'),
        requestAIResource('/api/ai/tools'),
        requestAIResource('/api/ai/automations').catch(() => ({ automations: [] })),
        requestAIResource('/api/ai/jobs').catch(() => ({ jobs: [] })),
        requestAIResource('/api/ai/capability-audit').catch(() => ({ events: [] })),
        requestAIResource('/api/ai/approvals').catch(() => ({ approvals: [] })),
        requestAIResource('/api/ai/quality/dashboard').catch(() => null),
        requestAIResource('/api/ai/semantic-associations')
            .catch(() => ({ associations: [] })),
        requestAIResource('/api/ai/quality/conformance').catch(() => null),
        requestAIResource('/api/ai/evals/models')
            .catch(() => ({ evaluations: [] })),
    ]);
    return {
        approvals: jsonRecords(approvalsPayload, 'approvals'),
        auditEvents: jsonRecords(auditPayload, 'events'),
        automations: jsonRecords(automationsPayload, 'automations'),
        capabilityConformance: optionalRecord(conformancePayload),
        issues: jsonRecords(skillsPayload, 'issues'),
        jobs: jsonRecords(jobsPayload, 'jobs'),
        modelEvaluations: jsonRecords(evaluationsPayload, 'evaluations'),
        qualityDashboard: optionalRecord(qualityPayload),
        semanticAssociations: jsonRecords(associationsPayload, 'associations'),
        skills: catalogRows(skillsPayload, 'skills')
            .map((row) => normalizeSkill(catalogRecord(row))),
        tools: catalogRows(toolsPayload, 'tools')
            .map((row) => normalizeTool(catalogRecord(row))),
    };
};
