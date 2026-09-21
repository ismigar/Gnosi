import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { assertApiSuccess, unwrapApiResult } from './errors';

export type LearnedSkill = components['schemas']['LearnedSkill'];
export type LearningWorkspace = components['schemas']['LearningWorkspace'];
export type LearningProject = components['schemas']['LearningProject'];
export type ProjectDraft = components['schemas']['ProjectDraft'];
export type SkillTrialResult = components['schemas']['SkillTrialResult'];
export type SkillPackage = components['schemas']['SkillPackage'];
export type AgentMemory = components['schemas']['PersonalMemoryResponse'];
export type MemoryDraft = components['schemas']['PersonalMemoryPayload'];

export async function fetchLearningWorkspace(agentId: string, sessionId = '', signal?: AbortSignal) {
    return unwrapApiResult(await apiClient.GET('/api/ai/agents/{agent_id}/learning', {
        params: { path: { agent_id: agentId }, query: { session_id: sessionId } }, signal,
    }));
}

export async function saveLearningProject(agentId: string, body: ProjectDraft, projectId = '') {
    if (projectId) return unwrapApiResult(await apiClient.PUT('/api/ai/agents/{agent_id}/projects/{project_id}', {
        params: { path: { agent_id: agentId, project_id: projectId } }, body,
    }));
    return unwrapApiResult(await apiClient.POST('/api/ai/agents/{agent_id}/projects', {
        params: { path: { agent_id: agentId } }, body,
    }));
}

export async function removeLearningProject(agentId: string, projectId: string) {
    return unwrapApiResult(await apiClient.DELETE('/api/ai/agents/{agent_id}/projects/{project_id}', {
        params: { path: { agent_id: agentId, project_id: projectId } },
    }));
}

export async function bindLearningProject(agentId: string, sessionId: string, projectId: string) {
    return unwrapApiResult(await apiClient.PUT('/api/ai/agents/{agent_id}/learning/{session_id}', {
        params: { path: { agent_id: agentId, session_id: sessionId } }, body: { project_id: projectId },
    }));
}

export async function prepareLearningDraft(body: components['schemas']['LearnRequest'], signal?: AbortSignal) {
    return unwrapApiResult(await apiClient.POST('/api/ai/learning/draft', { body, signal }));
}

export async function saveLearnedSkill(body: components['schemas']['SaveLearningRequest']) {
    return unwrapApiResult(await apiClient.POST('/api/ai/learning/skills', { body }));
}

export async function runSkillTrial(body: components['schemas']['SkillTrialRequest'], signal?: AbortSignal) {
    return unwrapApiResult(await apiClient.POST('/api/ai/learning/trial', { body, signal }));
}

export async function fetchSkillPackage(skillId: string) {
    return unwrapApiResult(await apiClient.GET('/api/ai/skills/{skill_id}/package', {
        params: { path: { skill_id: skillId } },
    }));
}

export async function fetchAgentMemories(agentId: string, signal?: AbortSignal) {
    return unwrapApiResult(await apiClient.GET('/api/ai/agents/{agent_id}/memories', {
        params: { path: { agent_id: agentId } }, signal,
    }));
}

export async function saveAgentMemory(agentId: string, body: MemoryDraft, memoryId = '') {
    if (memoryId) return unwrapApiResult(await apiClient.PUT('/api/ai/agents/{agent_id}/memories/{memory_id}', {
        params: { path: { agent_id: agentId, memory_id: memoryId } }, body,
    }));
    return unwrapApiResult(await apiClient.POST('/api/ai/agents/{agent_id}/memories', {
        params: { path: { agent_id: agentId } }, body,
    }));
}

export async function removeAgentMemory(agentId: string, memoryId: string) {
    assertApiSuccess(await apiClient.DELETE('/api/ai/agents/{agent_id}/memories/{memory_id}', {
        params: { path: { agent_id: agentId, memory_id: memoryId } },
    }));
}

export async function validateSkillPackage(value: unknown): Promise<SkillPackage> {
    // Validation belongs to the server; imported data never bypasses its schema.
    return unwrapApiResult(await apiClient.POST('/api/ai/learning/package/validate', {
        body: value as SkillPackage,
    }));
}
