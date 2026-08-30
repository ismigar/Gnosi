import { useCallback, useEffect, useMemo, useState } from 'react';

import { logError } from '../../../shared/notifications/notifyError';
import {
    cloneSkillPayload,
    normalizeSkill,
    skillPayload,
    type NormalizedSkill,
    type NormalizedTool,
    type SkillDraft,
} from './aiSettingsUtils';
import {
    affectedAgentsFromError,
    AIResourceRequestError,
    isJsonRecord,
    jsonRecords,
    jsonString,
    requestAIResource,
    type JsonRecord,
} from './aiResourcesApi';
import {
    loadAIResourceSnapshot,
    mutationCatalogRecord,
    optionalRecord,
    stringArray,
    type AIResourceSnapshot,
} from './aiResourcesSnapshot';


interface AutomationDraft extends JsonRecord {
    agent_id: string;
    enabled: boolean;
    id?: string;
    instruction: string;
    interval_minutes: number | string;
    max_ai_calls_per_run: number | string;
    max_runs_per_day: number | string;
    max_runtime_seconds: number | string;
    name: string;
    skill_id: string;
}


interface AgentMemoryDraft extends JsonRecord {
    category?: string;
    enabled?: boolean;
    expires_at?: string | null;
    memory_id?: string;
    provenance?: string;
    revision?: string | number | null;
    text: string;
}


interface ApprovalRecord extends JsonRecord {
    agent_id: string;
    confirmation_id: string;
    session_id: string;
}


const requestErrorMessage = (error: unknown): string => (
    error instanceof Error ? error.message : 'Unknown AI resource request error.'
);


const signalIsAborted = (signal: AbortSignal): boolean => signal.aborted;


export const useAIResources = (enabled: boolean) => {
    const [skills, setSkills] = useState<NormalizedSkill[]>([]);
    const [tools, setTools] = useState<NormalizedTool[]>([]);
    const [issues, setIssues] = useState<JsonRecord[]>([]);
    const [automations, setAutomations] = useState<JsonRecord[]>([]);
    const [jobs, setJobs] = useState<JsonRecord[]>([]);
    const [auditEvents, setAuditEvents] = useState<JsonRecord[]>([]);
    const [approvals, setApprovals] = useState<JsonRecord[]>([]);
    const [qualityDashboard, setQualityDashboard] = useState<JsonRecord | null>(null);
    const [semanticAssociations, setSemanticAssociations] = useState<JsonRecord[]>([]);
    const [capabilityConformance, setCapabilityConformance] = useState<JsonRecord | null>(null);
    const [modelEvaluations, setModelEvaluations] = useState<JsonRecord[]>([]);
    const [agentMemories, setAgentMemories] = useState<JsonRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const applySnapshot = useCallback((snapshot: AIResourceSnapshot): void => {
        setSkills(snapshot.skills);
        setTools(snapshot.tools);
        setIssues(snapshot.issues);
        setAutomations(snapshot.automations);
        setJobs(snapshot.jobs);
        setAuditEvents(snapshot.auditEvents);
        setApprovals(snapshot.approvals);
        setQualityDashboard(snapshot.qualityDashboard);
        setSemanticAssociations(snapshot.semanticAssociations);
        setCapabilityConformance(snapshot.capabilityConformance);
        setModelEvaluations(snapshot.modelEvaluations);
    }, []);

    const reload = useCallback(async (): Promise<void> => {
        if (!enabled) return;
        setLoading(true);
        setError('');
        try {
            applySnapshot(await loadAIResourceSnapshot());
        } catch (requestError) {
            logError('ai-resource-catalog-load', requestError);
            setError(requestErrorMessage(requestError));
        } finally {
            setLoading(false);
        }
    }, [applySnapshot, enabled]);

    useEffect(() => {
        if (!enabled) return undefined;
        const controller = new AbortController();
        void Promise.resolve().then(async () => {
            if (signalIsAborted(controller.signal)) return;
            setLoading(true);
            setError('');
            try {
                const snapshot = await loadAIResourceSnapshot();
                if (!signalIsAborted(controller.signal)) applySnapshot(snapshot);
            } catch (requestError) {
                if (signalIsAborted(controller.signal)) return;
                logError('ai-resource-catalog-load', requestError);
                setError(requestErrorMessage(requestError));
            } finally {
                if (!signalIsAborted(controller.signal)) setLoading(false);
            }
        });
        return () => {
            controller.abort();
        };
    }, [applySnapshot, enabled]);

    const createSkill = useCallback(async (
        draft: SkillDraft,
    ): Promise<NormalizedSkill> => {
        const payload = await requestAIResource('/api/ai/skills', {
            method: 'POST',
            body: JSON.stringify(skillPayload(draft)),
        });
        const created = normalizeSkill(mutationCatalogRecord(payload));
        setSkills(current => [...current.filter(skill => skill.id !== created.id), created]);
        return created;
    }, []);

    const updateSkill = useCallback(async (
        skill: NormalizedSkill,
        draft: SkillDraft,
    ): Promise<NormalizedSkill> => {
        const payload = await requestAIResource(`/api/ai/skills/${encodeURIComponent(skill.id)}`, {
            method: 'PUT',
            body: JSON.stringify(skillPayload(draft, skill.revision)),
        });
        const updated = normalizeSkill(mutationCatalogRecord(payload));
        setSkills(current => current.map(item => item.id === updated.id ? updated : item));
        return updated;
    }, []);

    const validateSkill = useCallback(async (
        skill: NormalizedSkill,
        draft: SkillDraft,
    ): Promise<unknown> => requestAIResource(
            `/api/ai/skills/${encodeURIComponent(skill.id)}/validate`,
            {
                method: 'POST',
                body: JSON.stringify(skillPayload(draft, skill.revision)),
            },
        ), []);

    const cloneSkill = useCallback(async (
        skill: NormalizedSkill,
        cloneName?: string,
    ): Promise<NormalizedSkill> => {
        const payload = await requestAIResource(`/api/ai/skills/${encodeURIComponent(skill.id)}/clone`, {
            method: 'POST',
            body: JSON.stringify(cloneSkillPayload(skill, cloneName)),
        });
        const created = normalizeSkill(mutationCatalogRecord(payload));
        setSkills(current => [...current.filter(item => item.id !== created.id), created]);
        return created;
    }, []);

    const deleteSkill = useCallback(async (
        skill: NormalizedSkill,
        unassign = false,
    ) => {
        try {
            await requestAIResource(
                `/api/ai/skills/${encodeURIComponent(skill.id)}${unassign ? '?unassign=true' : ''}`,
                {
                    method: 'DELETE',
                },
            );
            setSkills(current => current.filter(item => item.id !== skill.id));
            return { deleted: true, affectedAgents: [] };
        } catch (requestError) {
            const affectedAgents = affectedAgentsFromError(requestError);
            if (
                requestError instanceof AIResourceRequestError
                && requestError.status === 409
                && affectedAgents.length > 0
            ) {
                return { deleted: false, affectedAgents };
            }
            throw requestError;
        }
    }, []);

    const assignAgentSkills = useCallback(async (
        agentId: string,
        skillIds: readonly string[],
    ): Promise<string[]> => {
        const currentAssignment = await requestAIResource(
            `/api/ai/agents/${encodeURIComponent(agentId)}/skills`,
        );
        const currentAssignmentRecord = optionalRecord(currentAssignment);
        const payload = await requestAIResource(`/api/ai/agents/${encodeURIComponent(agentId)}/skills`, {
            method: 'PUT',
            body: JSON.stringify({
                skill_ids: skillIds,
                ...(currentAssignmentRecord?.revision
                    ? { expected_revision: currentAssignmentRecord.revision }
                    : {}),
            }),
        });
        const payloadRecord = optionalRecord(payload);
        const agentRecord = optionalRecord(payloadRecord?.agent);
        const assignedIds = stringArray(
            payloadRecord?.skill_ids ?? agentRecord?.skill_ids,
            skillIds,
        );
        setSkills(current => current.map(skill => {
            const agentIds = new Set(skill.agentIds);
            if (assignedIds.includes(skill.id)) agentIds.add(agentId);
            else agentIds.delete(agentId);
            return { ...skill, agentIds: [...agentIds] };
        }));
        return assignedIds;
    }, []);

    const saveAutomation = useCallback(async (
        draft: AutomationDraft,
    ): Promise<JsonRecord> => {
        const editing = automations.find(item => item.id === draft.id);
        const editingId = jsonString(editing?.id);
        const payload = {
            name: draft.name,
            agent_id: draft.agent_id,
            skill_id: draft.skill_id,
            instruction: draft.instruction,
            interval_minutes: Number(draft.interval_minutes),
            enabled: draft.enabled,
            max_runs_per_day: Number(draft.max_runs_per_day),
            max_ai_calls_per_run: Number(draft.max_ai_calls_per_run),
            max_runtime_seconds: Number(draft.max_runtime_seconds),
            ...(editing?.revision ? { expected_revision: editing.revision } : {}),
        };
        const savedPayload = await requestAIResource(
            editingId
                ? `/api/ai/automations/${encodeURIComponent(editingId)}`
                : '/api/ai/automations',
            { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload) },
        );
        if (!isJsonRecord(savedPayload)) {
            throw new Error('AI automation response is not an object.');
        }
        const saved = savedPayload;
        setAutomations(current => [
            ...current.filter(item => item.id !== saved.id), saved,
        ].sort((left, right) => (
            (jsonString(left.name) ?? '').localeCompare(jsonString(right.name) ?? '')
        )));
        return saved;
    }, [automations]);

    const deleteAutomation = useCallback(async (
        automationId: string,
    ): Promise<void> => {
        await requestAIResource(`/api/ai/automations/${encodeURIComponent(automationId)}`, {
            method: 'DELETE',
        });
        setAutomations(current => current.filter(item => item.id !== automationId));
    }, []);

    const runAutomation = useCallback(async (
        automationId: string,
    ): Promise<unknown> => requestAIResource(
        `/api/ai/automations/${encodeURIComponent(automationId)}/run`,
        { method: 'POST' },
    ), []);

    const resolveApproval = useCallback(async (
        approval: ApprovalRecord,
        decision: 'cancel' | 'confirm',
    ): Promise<void> => {
        await requestAIResource(
            `/api/chat/confirmations/${encodeURIComponent(approval.confirmation_id)}/${decision}`,
            {
                method: 'POST',
                body: JSON.stringify({
                    agent_id: approval.agent_id,
                    session_id: approval.session_id,
                }),
            },
        );
        setApprovals(current => current.filter(
            item => item.confirmation_id !== approval.confirmation_id,
        ));
    }, []);

    const addSemanticAssociation = useCallback(async (
        trigger: string,
        relatedTerms: readonly string[],
    ): Promise<void> => {
        await requestAIResource('/api/ai/semantic-associations', {
            method: 'POST',
            body: JSON.stringify({ trigger, related_terms: relatedTerms }),
        });
        const payload = await requestAIResource('/api/ai/semantic-associations');
        setSemanticAssociations(jsonRecords(payload, 'associations'));
    }, []);

    const removeSemanticAssociation = useCallback(async (
        associationId: string,
    ): Promise<void> => {
        await requestAIResource(`/api/ai/semantic-associations/${encodeURIComponent(associationId)}`, {
            method: 'DELETE',
        });
        setSemanticAssociations(current => current.filter(item => item.id !== associationId));
    }, []);

    const loadAgentMemories = useCallback(async (
        agentId: string,
    ): Promise<JsonRecord[]> => {
        if (!agentId) {
            setAgentMemories([]);
            return [];
        }
        const payload = await requestAIResource(`/api/ai/agents/${encodeURIComponent(agentId)}/memories`);
        const rows = jsonRecords(payload, 'memories');
        setAgentMemories(rows);
        return rows;
    }, []);

    const saveAgentMemory = useCallback(async (
        agentId: string,
        memory: AgentMemoryDraft,
    ): Promise<JsonRecord[]> => {
        const editing = Boolean(memory.memory_id);
        await requestAIResource(
            editing
                ? `/api/ai/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(memory.memory_id ?? '')}`
                : `/api/ai/agents/${encodeURIComponent(agentId)}/memories`,
            {
                method: editing ? 'PUT' : 'POST',
                body: JSON.stringify({
                    text: memory.text,
                    category: memory.category || 'preference',
                    provenance: memory.provenance || 'user',
                    expires_at: memory.expires_at || null,
                    enabled: memory.enabled !== false,
                    ...(editing ? { expected_revision: memory.revision } : {}),
                }),
            },
        );
        return loadAgentMemories(agentId);
    }, [loadAgentMemories]);

    const removeAgentMemory = useCallback(async (
        agentId: string,
        memoryId: string,
    ): Promise<JsonRecord[]> => {
        await requestAIResource(`/api/ai/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(memoryId)}`, { method: 'DELETE' });
        return loadAgentMemories(agentId);
    }, [loadAgentMemories]);

    const runModelEvaluation = useCallback(async (
        agentId: string,
    ): Promise<unknown> => {
        const result = await requestAIResource(`/api/ai/evals/models/${encodeURIComponent(agentId)}/run`, { method: 'POST' });
        const payload = await requestAIResource('/api/ai/evals/models');
        setModelEvaluations(jsonRecords(payload, 'evaluations'));
        return result;
    }, []);

    return useMemo(() => ({
        skills,
        tools,
        issues,
        automations,
        jobs,
        auditEvents,
        approvals,
        qualityDashboard,
        semanticAssociations,
        capabilityConformance,
        modelEvaluations,
        agentMemories,
        loading,
        error,
        reload,
        createSkill,
        updateSkill,
        validateSkill,
        cloneSkill,
        deleteSkill,
        assignAgentSkills,
        saveAutomation,
        deleteAutomation,
        runAutomation,
        resolveApproval,
        addSemanticAssociation,
        removeSemanticAssociation,
        loadAgentMemories,
        saveAgentMemory,
        removeAgentMemory,
        runModelEvaluation,
    }), [
        assignAgentSkills,
        auditEvents,
        approvals,
        qualityDashboard,
        semanticAssociations,
        capabilityConformance,
        modelEvaluations,
        agentMemories,
        automations,
        cloneSkill,
        createSkill,
        deleteSkill,
        error,
        loading,
        reload,
        issues,
        jobs,
        skills,
        tools,
        saveAutomation,
        deleteAutomation,
        runAutomation,
        resolveApproval,
        addSemanticAssociation,
        removeSemanticAssociation,
        loadAgentMemories,
        saveAgentMemory,
        removeAgentMemory,
        runModelEvaluation,
        updateSkill,
        validateSkill,
    ]);
};
