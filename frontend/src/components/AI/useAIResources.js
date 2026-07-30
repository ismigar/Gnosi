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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const reload = useCallback(async () => {
        if (!enabled) return;
        setLoading(true);
        setError('');
        try {
            const [skillsPayload, toolsPayload] = await Promise.all([
                request('/api/ai/skills'),
                request('/api/ai/tools'),
            ]);
            setSkills(catalogRows(skillsPayload, 'skills').map(normalizeSkill));
            setTools(catalogRows(toolsPayload, 'tools').map(normalizeTool));
            setIssues(Array.isArray(skillsPayload?.issues) ? skillsPayload.issues : []);
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
        ]).then(([skillsPayload, toolsPayload]) => {
            if (cancelled) return;
            setSkills(catalogRows(skillsPayload, 'skills').map(normalizeSkill));
            setTools(catalogRows(toolsPayload, 'tools').map(normalizeTool));
            setIssues(Array.isArray(skillsPayload?.issues) ? skillsPayload.issues : []);
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

    return useMemo(() => ({
        skills,
        tools,
        issues,
        loading,
        error,
        reload,
        createSkill,
        updateSkill,
        validateSkill,
        cloneSkill,
        deleteSkill,
        assignAgentSkills,
    }), [
        assignAgentSkills,
        cloneSkill,
        createSkill,
        deleteSkill,
        error,
        loading,
        reload,
        issues,
        skills,
        tools,
        updateSkill,
        validateSkill,
    ]);
};
