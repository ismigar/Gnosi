import { useCallback, useEffect, useMemo, useState } from 'react';

import {
    catalogRows,
    cloneSkillPayload,
    normalizeSkill,
    normalizeTool,
    skillPayload,
} from './aiSettingsUtils';

class AIResourceRequestError extends Error {
    constructor(message, status, payload) {
        super(message);
        this.name = 'AIResourceRequestError';
        this.status = status;
        this.payload = payload;
    }
}

const request = async (url, options = {}) => {
    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const detail = payload?.detail;
        const message = (
            typeof detail === 'string'
                ? detail
                : detail?.message || payload?.message || `HTTP ${response.status}`
        );
        throw new AIResourceRequestError(message, response.status, payload);
    }
    return payload;
};

const affectedAgentsFromError = (error) => {
    const detail = error?.payload?.detail;
    const rows = (
        detail?.affected_agents
        ?? error?.payload?.affected_agents
        ?? detail?.agents
        ?? error?.payload?.agents
        ?? []
    );
    return Array.isArray(rows) ? rows : [];
};

export const useAIResources = (enabled) => {
    const [skills, setSkills] = useState([]);
    const [tools, setTools] = useState([]);
    const [issues, setIssues] = useState([]);
    const [automations, setAutomations] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [auditEvents, setAuditEvents] = useState([]);
    const [approvals, setApprovals] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const reload = useCallback(async () => {
        if (!enabled) return;
        setLoading(true);
        setError('');
        try {
            const [skillsPayload, toolsPayload, automationsPayload, jobsPayload, auditPayload, approvalsPayload] = await Promise.all([
                request('/api/ai/skills'),
                request('/api/ai/tools'),
                request('/api/ai/automations').catch(() => ({ automations: [] })),
                request('/api/ai/jobs').catch(() => ({ jobs: [] })),
                request('/api/ai/capability-audit').catch(() => ({ events: [] })),
                request('/api/ai/approvals').catch(() => ({ approvals: [] })),
            ]);
            setSkills(catalogRows(skillsPayload, 'skills').map(normalizeSkill));
            setTools(catalogRows(toolsPayload, 'tools').map(normalizeTool));
            setIssues(Array.isArray(skillsPayload?.issues) ? skillsPayload.issues : []);
            setAutomations(Array.isArray(automationsPayload?.automations) ? automationsPayload.automations : []);
            setJobs(Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : []);
            setAuditEvents(Array.isArray(auditPayload?.events) ? auditPayload.events : []);
            setApprovals(Array.isArray(approvalsPayload?.approvals) ? approvalsPayload.approvals : []);
        } catch (requestError) {
            console.error('Error loading AI skill and tool catalogs:', requestError);
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, [enabled]);

    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        setLoading(true);
        setError('');
        Promise.all([
            request('/api/ai/skills'),
            request('/api/ai/tools'),
            request('/api/ai/automations').catch(() => ({ automations: [] })),
            request('/api/ai/jobs').catch(() => ({ jobs: [] })),
            request('/api/ai/capability-audit').catch(() => ({ events: [] })),
            request('/api/ai/approvals').catch(() => ({ approvals: [] })),
        ]).then(([skillsPayload, toolsPayload, automationsPayload, jobsPayload, auditPayload, approvalsPayload]) => {
            if (cancelled) return;
            setSkills(catalogRows(skillsPayload, 'skills').map(normalizeSkill));
            setTools(catalogRows(toolsPayload, 'tools').map(normalizeTool));
            setIssues(Array.isArray(skillsPayload?.issues) ? skillsPayload.issues : []);
            setAutomations(Array.isArray(automationsPayload?.automations) ? automationsPayload.automations : []);
            setJobs(Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : []);
            setAuditEvents(Array.isArray(auditPayload?.events) ? auditPayload.events : []);
            setApprovals(Array.isArray(approvalsPayload?.approvals) ? approvalsPayload.approvals : []);
        }).catch(requestError => {
            if (cancelled) return;
            console.error('Error loading AI skill and tool catalogs:', requestError);
            setError(requestError.message);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [enabled]);

    const createSkill = useCallback(async draft => {
        const payload = await request('/api/ai/skills', {
            method: 'POST',
            body: JSON.stringify(skillPayload(draft)),
        });
        const created = normalizeSkill(payload?.skill ?? payload);
        setSkills(current => [...current.filter(skill => skill.id !== created.id), created]);
        return created;
    }, []);

    const updateSkill = useCallback(async (skill, draft) => {
        const payload = await request(`/api/ai/skills/${encodeURIComponent(skill.id)}`, {
            method: 'PUT',
            body: JSON.stringify(skillPayload(draft, skill.revision)),
        });
        const updated = normalizeSkill(payload?.skill ?? payload);
        setSkills(current => current.map(item => item.id === updated.id ? updated : item));
        return updated;
    }, []);

    const validateSkill = useCallback(async (skill, draft) => request(
        `/api/ai/skills/${encodeURIComponent(skill.id)}/validate`,
        {
            method: 'POST',
            body: JSON.stringify(skillPayload(draft, skill.revision)),
        },
    ), []);

    const cloneSkill = useCallback(async (skill, cloneName) => {
        const payload = await request(`/api/ai/skills/${encodeURIComponent(skill.id)}/clone`, {
            method: 'POST',
            body: JSON.stringify(cloneSkillPayload(skill, cloneName)),
        });
        const created = normalizeSkill(payload?.skill ?? payload);
        setSkills(current => [...current.filter(item => item.id !== created.id), created]);
        return created;
    }, []);

    const deleteSkill = useCallback(async (skill, unassign = false) => {
        try {
            await request(
                `/api/ai/skills/${encodeURIComponent(skill.id)}${unassign ? '?unassign=true' : ''}`,
                {
                    method: 'DELETE',
                },
            );
            setSkills(current => current.filter(item => item.id !== skill.id));
            return { deleted: true, affectedAgents: [] };
        } catch (requestError) {
            const affectedAgents = affectedAgentsFromError(requestError);
            if (requestError.status === 409 && affectedAgents.length > 0) {
                return { deleted: false, affectedAgents };
            }
            throw requestError;
        }
    }, []);

    const assignAgentSkills = useCallback(async (agentId, skillIds) => {
        const currentAssignment = await request(
            `/api/ai/agents/${encodeURIComponent(agentId)}/skills`,
        );
        const payload = await request(`/api/ai/agents/${encodeURIComponent(agentId)}/skills`, {
            method: 'PUT',
            body: JSON.stringify({
                skill_ids: skillIds,
                ...(currentAssignment?.revision
                    ? { expected_revision: currentAssignment.revision }
                    : {}),
            }),
        });
        const assignedIds = payload?.skill_ids ?? payload?.agent?.skill_ids ?? skillIds;
        setSkills(current => current.map(skill => {
            const agentIds = new Set(skill.agentIds);
            if (assignedIds.includes(skill.id)) agentIds.add(agentId);
            else agentIds.delete(agentId);
            return { ...skill, agentIds: [...agentIds] };
        }));
        return assignedIds;
    }, []);

    const saveAutomation = useCallback(async draft => {
        const editing = automations.find(item => item.id === draft.id);
        const payload = {
            name: draft.name,
            agent_id: draft.agent_id,
            skill_id: draft.skill_id,
            instruction: draft.instruction,
            interval_minutes: Number(draft.interval_minutes),
            enabled: Boolean(draft.enabled),
            max_runs_per_day: Number(draft.max_runs_per_day),
            max_ai_calls_per_run: Number(draft.max_ai_calls_per_run),
            max_runtime_seconds: Number(draft.max_runtime_seconds),
            ...(editing?.revision ? { expected_revision: editing.revision } : {}),
        };
        const saved = await request(
            editing
                ? `/api/ai/automations/${encodeURIComponent(editing.id)}`
                : '/api/ai/automations',
            { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) },
        );
        setAutomations(current => [
            ...current.filter(item => item.id !== saved.id), saved,
        ].sort((left, right) => left.name.localeCompare(right.name)));
        return saved;
    }, [automations]);

    const deleteAutomation = useCallback(async automationId => {
        await request(`/api/ai/automations/${encodeURIComponent(automationId)}`, {
            method: 'DELETE',
        });
        setAutomations(current => current.filter(item => item.id !== automationId));
    }, []);

    const runAutomation = useCallback(async automationId => request(
        `/api/ai/automations/${encodeURIComponent(automationId)}/run`,
        { method: 'POST' },
    ), []);

    const resolveApproval = useCallback(async (approval, decision) => {
        await request(
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

    return useMemo(() => ({
        skills,
        tools,
        issues,
        automations,
        jobs,
        auditEvents,
        approvals,
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
    }), [
        assignAgentSkills,
        auditEvents,
        approvals,
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
        updateSkill,
        validateSkill,
    ]);
};
