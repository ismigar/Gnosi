import type { RawCatalogRecord } from './aiSettingsUtils';
import type { useAIResources } from './useAIResources';


export type AIResourcesController = ReturnType<typeof useAIResources>;


export interface AIResourceAgent extends RawCatalogRecord {
    id: string;
    name?: string;
    skill_ids?: string[];
}


export type SkillResources = Pick<
    AIResourcesController,
    | 'cloneSkill'
    | 'createSkill'
    | 'deleteSkill'
    | 'error'
    | 'issues'
    | 'loading'
    | 'reload'
    | 'skills'
    | 'tools'
    | 'updateSkill'
    | 'validateSkill'
>;


export type ToolResources = Pick<
    AIResourcesController,
    'error' | 'loading' | 'reload' | 'tools'
>;
