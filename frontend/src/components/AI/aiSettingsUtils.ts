type UnknownRecord = Record<string, unknown>;

interface RawOrigin extends UnknownRecord {
    id?: string;
    kind?: string;
    plugin_id?: string;
    type?: string;
}

interface NormalizedOrigin extends RawOrigin {
    id: string;
    label: string;
    type: string;
}

interface RawCatalogRecord extends UnknownRecord {
    activation?: string;
    activation_policy?: string;
    agent_assignable?: boolean;
    agent_ids?: unknown;
    agents?: unknown;
    approval?: { status?: string };
    approval_status?: string;
    assignable?: boolean;
    available?: boolean;
    capabilities?: unknown;
    cloneable?: boolean;
    confirmation?: string;
    confirmation_policy?: string;
    consumers?: unknown;
    deletable?: boolean;
    description?: string;
    editable?: boolean;
    effect?: unknown;
    effect_classes?: unknown;
    effects?: unknown;
    enabled?: boolean;
    etag?: string | number | null;
    id?: string;
    input_schema?: unknown;
    instructions?: string;
    kind?: string;
    metadata?: {
        required?: boolean;
        required_for_agent?: boolean | string | readonly string[];
    };
    minimum_role?: string;
    missing_tool_ids?: unknown;
    model?: string;
    model_id?: string;
    name?: string;
    origin?: RawOrigin | string | null;
    output_schema?: unknown;
    prompt?: string;
    provider?: string;
    required?: boolean;
    required_agent_ids?: unknown;
    required_for_agents?: unknown;
    required_role?: string;
    revision?: string | number | null;
    runtime_adapter_available?: boolean;
    skill_id?: string;
    skill_ids?: unknown;
    skills?: unknown;
    source?: RawOrigin | string | null;
    status?: string;
    tags?: unknown;
    title?: string;
    tool_call?: boolean;
    tool_id?: string;
    tool_ids?: unknown;
    tools?: unknown;
    unavailable_tool_ids?: unknown;
    version?: string | number;
}

export interface NormalizedTool extends RawCatalogRecord {
    approvalStatus: string;
    available: boolean;
    confirmation: string;
    description: string;
    effects: unknown[];
    id: string;
    minimumRole: string;
    name: string;
    origin: NormalizedOrigin;
    skillIds: unknown[];
    status: string;
    version: string | number;
}

export interface NormalizedSkill extends RawCatalogRecord {
    activation: string;
    agentIds: string[];
    assignable: boolean;
    available: boolean;
    cloneable: boolean;
    deletable: boolean;
    description: string;
    editable: boolean;
    effects: unknown[];
    enabled: boolean;
    id: string;
    instructions: string;
    kind: string;
    missingToolIds: unknown[];
    name: string;
    origin: NormalizedOrigin;
    required: boolean;
    requiredAgentIds: unknown[];
    revision: string | number | null;
    status: string;
    toolIds: string[];
    version: string | number;
}

interface ModelSelection {
    model?: string;
    provider?: string;
}

interface SkillDraft {
    activation: string;
    description: string;
    instructions: string;
    name: string;
    toolIds?: readonly unknown[];
    [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

const asArray = (value: unknown): unknown[] => (isUnknownArray(value) ? value : []);
const asRecords = (value: unknown): RawCatalogRecord[] => (
    asArray(value).filter(isRecord)
);
const asStringArray = (value: unknown): unknown[] => {
    if (isUnknownArray(value)) return value;
    if (typeof value === 'string' && value) return [value];
    return [];
};

export const catalogRows = (payload: unknown, key: string): unknown[] => {
    if (Array.isArray(payload)) return payload;
    if (!isRecord(payload)) return [];
    return asArray(payload[key] ?? payload.items ?? payload.data);
};

export const modelRouteKey = (provider?: string, model?: string): string => (
    provider && model ? `${provider}||${model}` : ''
);

export const parseModelRouteKey = (value?: string | null) => {
    const normalized = value || '';
    const separator = normalized.indexOf('||');
    if (separator < 0) return { provider: '', model: '' };
    return {
        provider: normalized.slice(0, separator),
        model: normalized.slice(separator + 2),
    };
};

export const groupEnabledModelRoutes = (
    registry: unknown,
    selected: ModelSelection = {},
) => {
    const groups = new Map<string, string[]>();
    asRecords(registry).forEach(row => {
        const provider = typeof row.provider === 'string' ? row.provider.trim() : '';
        const model = typeof row.model_id === 'string' ? row.model_id.trim() : '';
        if (row.enabled !== true || !provider || !model) return;
        if (!groups.has(provider)) groups.set(provider, []);
        const models = groups.get(provider);
        if (models && !models.includes(model)) models.push(model);
    });

    const selectedProvider = selected.provider || '';
    const selectedModel = selected.model || '';
    const selectedKey = modelRouteKey(selectedProvider, selectedModel);
    const selectedAvailable = !selectedKey || [...groups.entries()].some(
        ([provider, models]) => (
            provider === selectedProvider && models.includes(selectedModel)
        ),
    );
    return {
        groups: [...groups.entries()],
        selectedKey,
        unavailableSelection: selectedAvailable ? null : {
            provider: selectedProvider,
            model: selectedModel,
            key: selectedKey,
        },
    };
};

const normalizeOrigin = (
    origin: RawOrigin | string | null | undefined,
    fallbackId = '',
): NormalizedOrigin => {
    if (isRecord(origin)) {
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

export const normalizeTool = (raw: RawCatalogRecord = {}): NormalizedTool => {
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

export const normalizeSkill = (raw: RawCatalogRecord = {}): NormalizedSkill => {
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
            typeof tool === 'string' ? tool : isRecord(tool) ? tool.id : undefined
        )).filter((toolId): toolId is string => typeof toolId === 'string' && Boolean(toolId)),
        effects: asStringArray(raw.effects ?? raw.effect_classes ?? raw.effect),
        agentIds: asArray(raw.agent_ids ?? raw.agents ?? raw.consumers).map(agent => (
            typeof agent === 'string' ? agent : isRecord(agent) ? agent.id : undefined
        )).filter((agentId): agentId is string => typeof agentId === 'string' && Boolean(agentId)),
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

export const skillEffects = (
    skill: NormalizedSkill | null | undefined,
    toolsById: ReadonlyMap<unknown, NormalizedTool>,
): unknown[] => {
    const effects = new Set(skill?.effects ?? []);
    (skill?.toolIds ?? []).forEach(toolId => {
        (toolsById.get(toolId)?.effects ?? []).forEach(effect => effects.add(effect));
    });
    return [...effects];
};

export const requiredSkillIdsForAgent = (
    agent: RawCatalogRecord | null | undefined,
    skills: readonly NormalizedSkill[] | null | undefined,
): Set<unknown> => {
    const required = new Set(asArray(agent?.required_skill_ids));
    (skills ?? []).forEach(skill => {
        if (skill.required && asArray(agent?.skill_ids).includes(skill.id)) required.add(skill.id);
        if (skill.requiredAgentIds.some(agentId => agentId === agent?.id)) required.add(skill.id);
    });
    return required;
};

const capabilityValue = (capabilities: unknown): boolean | null => {
    if (isUnknownArray(capabilities)) return capabilities.includes('tools');
    if (isRecord(capabilities) && 'tools' in capabilities) {
        return Boolean(capabilities.tools);
    }
    return null;
};

export const modelToolCompatibility = (
    agent: RawCatalogRecord | null | undefined,
    registry: unknown,
): boolean | null => {
    const fromAgent = capabilityValue(agent?.capabilities);
    if (fromAgent !== null) return fromAgent;

    const modelEntry = asRecords(registry).find(entry => (
        entry.provider === agent?.provider
        && (entry.model_id || entry.model) === agent?.model
    ));
    if (!modelEntry) return null;

    const fromRegistry = capabilityValue(modelEntry.capabilities);
    if (fromRegistry !== null) return fromRegistry;
    if (typeof modelEntry.tool_call === 'boolean') return modelEntry.tool_call;
    if (Array.isArray(modelEntry.tags)) return modelEntry.tags.includes('tools');
    return null;
};

export const agentSkillWarnings = (
    agent: RawCatalogRecord,
    selectedIds: readonly string[],
    skills: readonly NormalizedSkill[],
    tools: readonly NormalizedTool[],
    registry: unknown,
) => {
    const selected = skills.filter(skill => selectedIds.includes(skill.id));
    const warnings: Array<{ type: string; skillNames?: string[] }> = [];
    const unavailable = selected.filter(skill => !skill.available || skill.missingToolIds.length > 0);
    if (unavailable.length > 0) {
        warnings.push({
            type: 'unavailable',
            skillNames: unavailable.map(skill => skill.name),
        });
    }

    const toolsById = new Map(tools.map(tool => [tool.id, tool]));
    const needsTools = selected.some(skill => (
        skill.toolIds.length > 0
        || skillEffects(skill, toolsById).length > 0
    ));
    if (needsTools && modelToolCompatibility(agent, registry) === false) {
        warnings.push({ type: 'model_tools' });
    }
    return warnings;
};

export const skillPayload = (draft: SkillDraft, revision: unknown = null) => ({
    name: draft.name.trim(),
    description: draft.description.trim(),
    instructions: draft.instructions.trim(),
    kind: 'agent',
    activation: draft.activation,
    tool_ids: asArray(draft.toolIds),
    ...(revision !== null ? { expected_revision: revision } : {}),
});

export const cloneSkillPayload = (
    skill: Pick<NormalizedSkill, 'name'>,
    name = `${skill.name} copy`,
) => ({
    name,
});
