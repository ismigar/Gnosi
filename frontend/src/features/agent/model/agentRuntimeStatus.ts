export type AgentRuntimeStatusKind =
  | 'model_missing'
  | 'model_no_tools'
  | 'missing_skills'
  | 'online'
  | 'ready'
  | 'unavailable_tools';


export interface AgentRuntimeState {
  readonly active_skill_ids?: readonly string[] | null;
  readonly missing_skill_ids?: readonly string[] | null;
  readonly supports_tools?: boolean | null;
  readonly tool_count?: number | string | null;
  readonly unavailable_tool_ids?: readonly string[] | null;
}


export interface AgentRuntimeStatus {
  readonly count: number;
  readonly ids: string[];
  readonly kind: AgentRuntimeStatusKind;
  readonly limited: boolean;
}


const values = (value: readonly string[] | null | undefined): string[] => (
  (value ?? []).filter(Boolean)
);


export function deriveAgentRuntimeStatus(
  runtime: AgentRuntimeState | null | undefined,
  hasModel: boolean,
): AgentRuntimeStatus {
  if (!hasModel) {
    return { kind: 'model_missing', limited: false, count: 0, ids: [] };
  }
  if (!runtime) return { kind: 'online', limited: false, count: 0, ids: [] };

  const activeSkills = values(runtime.active_skill_ids);
  const missingSkills = values(runtime.missing_skill_ids);
  const unavailableTools = values(runtime.unavailable_tool_ids);
  const toolCount = Math.max(0, Number(runtime.tool_count) || 0);

  if (activeSkills.length > 0 && runtime.supports_tools === false) {
    return {
      kind: 'model_no_tools',
      limited: true,
      count: activeSkills.length,
      ids: activeSkills,
    };
  }
  if (missingSkills.length > 0) {
    return {
      kind: 'missing_skills',
      limited: true,
      count: missingSkills.length,
      ids: missingSkills,
    };
  }
  if (unavailableTools.length > 0) {
    return {
      kind: 'unavailable_tools',
      limited: true,
      count: unavailableTools.length,
      ids: unavailableTools,
    };
  }
  if (runtime.supports_tools && toolCount > 0) {
    return { kind: 'ready', limited: false, count: toolCount, ids: [] };
  }
  return { kind: 'online', limited: false, count: 0, ids: [] };
}
