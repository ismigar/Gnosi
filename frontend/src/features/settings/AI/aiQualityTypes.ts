export interface AIQualityAgent {
    id: string;
    name: string;
}


export interface AgentMemory {
    category: string;
    enabled?: boolean;
    expires_at?: string | null;
    memory_id: string;
    provenance?: string;
    revision?: string | number | null;
    text: string;
}


export interface AgentMemoryDraft {
    category: string;
    enabled?: boolean;
    expires_at?: string | null;
    memory_id?: string;
    provenance?: string;
    revision?: string | number | null;
    text: string;
}


interface QualityCounts {
    completed_turns?: number;
    errors?: number;
    latency_buckets?: { fast?: number };
    verification?: { passed?: number };
}


interface CapabilityHealth {
    average_latency_ms?: number;
    capability_id: string;
    failures?: number;
    status: string;
    successes?: number;
}


interface QualityDashboard {
    capabilities?: readonly CapabilityHealth[];
    quality?: QualityCounts;
}


interface ModelEvaluation {
    estimated_cost_usd?: number | string | null;
    evaluation_id: string;
    latency_ms: number;
    model: string;
    provider: string;
    score?: number | null;
}


interface CapabilityConformance {
    counts?: {
        legacy?: number;
        partial?: number;
        pass?: number;
    };
}


interface SemanticAssociation {
    id: string;
    related_term: string;
    trigger_term: string;
}


export interface AIQualityResources {
    addSemanticAssociation: (
        trigger: string,
        relatedTerms: readonly string[],
    ) => Promise<unknown>;
    agentMemories: readonly AgentMemory[];
    capabilityConformance?: CapabilityConformance | null;
    loadAgentMemories: (agentId: string) => Promise<unknown>;
    loading: boolean;
    modelEvaluations: readonly ModelEvaluation[];
    qualityDashboard?: QualityDashboard | null;
    reload: () => Promise<unknown>;
    removeAgentMemory: (
        agentId: string,
        memoryId: string,
    ) => Promise<unknown>;
    removeSemanticAssociation: (associationId: string) => Promise<unknown>;
    runModelEvaluation: (agentId: string) => Promise<unknown>;
    saveAgentMemory: (
        agentId: string,
        memory: AgentMemoryDraft,
    ) => Promise<unknown>;
    semanticAssociations: readonly SemanticAssociation[];
}
