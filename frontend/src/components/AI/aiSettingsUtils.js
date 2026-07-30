const asArray = (value) => (Array.isArray(value) ? value : []);
const asStringArray = value => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value) return [value];
    return [];
};

export const catalogRows = (payload, key) => {
    if (Array.isArray(payload)) return payload;
    return asArray(payload?.[key] ?? payload?.items ?? payload?.data);
};

const normalizeOrigin = (origin, fallbackId = '') => {
    if (origin && typeof origin === 'object') {
        const type = origin.type || origin.kind || 'unknown';
        const id = origin.id || origin.plugin_id || '';
        return { type, id, label: id ? `${type}:${id}` : type };
    }

    if (typeof origin === 'string' && origin.trim()) {
        const value = origin.trim();
        if (value.startsWith('plugin:')) {
            return { type: 'plugin', id: value.slice(7), label: value };
        }
        if (value.startsWith('plugin.')) {
            const pluginId = value.split('.')[1] || '';
            return { type: 'plugin', id: pluginId, label: pluginId ? `plugin:${pluginId}` : value };
        }
        return { type: value === 'user' || value === 'core' ? value : 'unknown', id: '', label: value };
    }

    if (fallbackId.startsWith('user.')) return { type: 'user', id: '', label: 'user' };
    if (fallbackId.startsWith('core.')) return { type: 'core', id: '', label: 'core' };
    if (fallbackId.startsWith('plugin.')) {
        const pluginId = fallbackId.split('.')[1] || '';
        return { type: 'plugin', id: pluginId, label: pluginId ? `plugin:${pluginId}` : 'plugin' };
    }
    return { type: 'unknown', id: '', label: 'unknown' };
};

export const normalizeTool = (raw = {}) => {
    const id = raw.id || raw.tool_id || '';
    const origin = normalizeOrigin(raw.origin ?? raw.source, id);
    const status = (
        raw.runtime_adapter_available === false
            ? 'unavailable'
            : raw.status || (raw.available === false ? 'unavailable' : 'available')
    );
    return {
        ...raw,
        id,
        name: raw.name || raw.title || id,
        description: raw.description || '',
        version: raw.version || '1',
        origin,
        effects: asStringArray(raw.effects ?? raw.effect_classes ?? raw.effect),
        status,
        available: (
            raw.available !== false
            && raw.runtime_adapter_available !== false
            && !['unavailable', 'revoked', 'pending', 'missing', 'disabled'].includes(status)
        ),
        minimumRole: raw.minimum_role || raw.required_role || '',
        confirmation: raw.confirmation || raw.confirmation_policy || 'none',
        inputSchema: raw.input_schema || null,
        outputSchema: raw.output_schema || null,
        skillIds: asArray(raw.skill_ids ?? raw.skills ?? raw.consumers),
        approvalStatus: raw.approval_status || raw.approval?.status || '',
    };
};

export const normalizeSkill = (raw = {}) => {
    const id = raw.id || raw.skill_id || '';
    const origin = normalizeOrigin(raw.origin ?? raw.source, id);
    const kind = raw.kind || 'agent';
    const status = raw.status || (raw.available === false ? 'unavailable' : 'available');
    const metadataRequired = raw.metadata?.required_for_agent;
    const metadataRequiredAgentIds = (
        metadataRequired === true && origin.type === 'plugin'
            ? [origin.id]
            : asStringArray(metadataRequired)
    );
    return {
        ...raw,
        id,
        name: raw.name || raw.title || id,
        description: raw.description || '',
        instructions: raw.instructions || raw.prompt || '',
        version: raw.version || '1',
        origin,
        kind,
        activation: raw.activation || raw.activation_policy || 'automatic',
        toolIds: asArray(raw.tool_ids ?? raw.tools).map(tool => (
            typeof tool === 'string' ? tool : tool?.id
        )).filter(Boolean),
        effects: asStringArray(raw.effects ?? raw.effect_classes ?? raw.effect),
        agentIds: asArray(raw.agent_ids ?? raw.agents ?? raw.consumers).map(agent => (
            typeof agent === 'string' ? agent : agent?.id
        )).filter(Boolean),
        requiredAgentIds: [
            ...new Set([
                ...asStringArray(raw.required_agent_ids ?? raw.required_for_agents),
                ...metadataRequiredAgentIds,
            ]),
        ],
        missingToolIds: asArray(raw.missing_tool_ids ?? raw.unavailable_tool_ids),
        assignable: raw.assignable ?? raw.agent_assignable ?? kind === 'agent',
        required: raw.required === true || raw.metadata?.required === true,
        enabled: raw.enabled !== false,
        available: (
            raw.available !== false
            && !['unavailable', 'revoked', 'pending', 'missing', 'disabled', 'suspended'].includes(status)
        ),
        status,
        editable: raw.editable ?? origin.type === 'user',
        deletable: raw.deletable ?? origin.type === 'user',
        cloneable: raw.cloneable ?? origin.type !== 'user',
        revision: raw.revision ?? raw.etag ?? null,
    };
};

export const skillEffects = (skill, toolsById) => {
    const effects = new Set(asArray(skill?.effects));
    asArray(skill?.toolIds).forEach(toolId => {
        asArray(toolsById?.get(toolId)?.effects).forEach(effect => effects.add(effect));
    });
    return [...effects];
};

export const requiredSkillIdsForAgent = (agent, skills) => {
    const required = new Set(asArray(agent?.required_skill_ids));
    asArray(skills).forEach(skill => {
        if (skill.required && asArray(agent?.skill_ids).includes(skill.id)) required.add(skill.id);
        if (skill.requiredAgentIds.includes(agent?.id)) required.add(skill.id);
    });
    return required;
};

const capabilityValue = (capabilities) => {
    if (Array.isArray(capabilities)) return capabilities.includes('tools');
    if (capabilities && typeof capabilities === 'object' && 'tools' in capabilities) {
        return Boolean(capabilities.tools);
    }
    return null;
};

export const modelToolCompatibility = (agent, registry) => {
    const fromAgent = capabilityValue(agent?.capabilities);
    if (fromAgent !== null) return fromAgent;

    const modelEntry = asArray(registry).find(entry => (
        entry?.provider === agent?.provider
        && (entry?.model_id || entry?.model) === agent?.model
    ));
    if (!modelEntry) return null;

    const fromRegistry = capabilityValue(modelEntry.capabilities);
    if (fromRegistry !== null) return fromRegistry;
    if (typeof modelEntry.tool_call === 'boolean') return modelEntry.tool_call;
    if (Array.isArray(modelEntry.tags)) return modelEntry.tags.includes('tools');
    return null;
};

export const agentSkillWarnings = (agent, selectedIds, skills, tools, registry) => {
    const selected = asArray(skills).filter(skill => selectedIds.includes(skill.id));
    const warnings = [];
    const unavailable = selected.filter(skill => !skill.available || skill.missingToolIds.length > 0);
    if (unavailable.length > 0) {
        warnings.push({
            type: 'unavailable',
            skillNames: unavailable.map(skill => skill.name),
        });
    }

    const toolsById = new Map(asArray(tools).map(tool => [tool.id, tool]));
    const needsTools = selected.some(skill => (
        skill.toolIds.length > 0
        || skillEffects(skill, toolsById).length > 0
    ));
    if (needsTools && modelToolCompatibility(agent, registry) === false) {
        warnings.push({ type: 'model_tools' });
    }
    return warnings;
};

export const skillPayload = (draft, revision = null) => ({
    name: draft.name.trim(),
    description: draft.description.trim(),
    instructions: draft.instructions.trim(),
    kind: 'agent',
    activation: draft.activation,
    tool_ids: asArray(draft.toolIds),
    ...(revision !== null ? { expected_revision: revision } : {}),
});

export const cloneSkillPayload = (skill, name = `${skill.name} copy`) => ({
    name,
});
