import { requiredSkillIdsForAgent, type NormalizedSkill } from '../AI/aiSettingsUtils';
import type { SettingsAgent } from '../global-settings/types';
import { botTask } from './botModelChoice';
import type { TaskId } from './taskRecommendations';

const operations: Readonly<Record<string, readonly TaskId[]>> = {
    writing: ['analyse'], reader: ['retrieve', 'analyse'], podcast: ['retrieve'], notebook: ['retrieve'],
    literature: ['retrieve', 'analyse'], mail: ['classify', 'extract'], social: ['analyse'],
    meeting: ['extract', 'analyse'], translation: ['analyse'], tables: ['extract'],
    knowledge: ['retrieve', 'analyse'], capture: ['extract'], learning: ['analyse'],
};
const skills: Readonly<Record<string, readonly TaskId[]>> = {
    'core.gnosi-vault': ['classify', 'extract', 'retrieve'], 'core.gnosi-jobs': ['workflow'],
    'core.gnosi-activity': ['analyse'], 'core.gnosi-contacts': ['extract', 'retrieve'],
    'core.gnosi-planning': ['workflow', 'analyse'], 'core.gnosi-memory': ['extract', 'retrieve'],
    'core.gnosi-calendar': ['extract', 'workflow'], 'core.gnosi-mail': ['classify', 'extract'],
    'core.gnosi-reader': ['retrieve', 'analyse'], 'core.gnosi-social': ['analyse'],
    'core.gnosi-notion': ['extract', 'workflow'], 'core.gnosi-notion-migration': ['extract', 'workflow'],
    'core.gnosi-project-status': ['analyse'], 'core.gnosi-weekly-review': ['analyse'],
    'core.gnosi-relationship-brief': ['retrieve', 'analyse'], 'core.gnosi-follow-up-manager': ['extract', 'analyse'],
    'core.gnosi-coordination': ['workflow'], 'core.gnosi-reader-topic-evolution': operations.reader ?? [],
    'core.gnosi-daily-briefing': operations.podcast ?? [], 'core.gnosi-notebooks': operations.notebook ?? [],
    'core.gnosi-literature': operations.literature ?? [], 'core.gnosi-inbox-triage': operations.mail ?? [],
    'core.gnosi-meeting-preparation': operations.meeting ?? [], 'core.gnosi-knowledge-capture': operations.capture ?? [],
    'core.gnosi-social-publishing': operations.social ?? [], 'core.gnosi-translation-workflow': operations.translation ?? [],
    'core.gnosi-translation': operations.translation ?? [], 'core.gnosi-research-dossier': operations.knowledge ?? [],
};
const plugins: Readonly<Record<string, readonly TaskId[]>> = {
    'llm-wiki': ['book', 'retrieve', 'analyse'], 'feeds-reader': ['retrieve', 'analyse'],
    'grounded-notebooks': ['retrieve'], resources: ['retrieve', 'analyse'], mail: ['classify', 'extract'],
    calendar: ['extract', 'analyse'], translation: ['analyse'], 'social-publishing': ['analyse'],
};

/** Deterministic advisory demand from assignments, never from the bot's model or free text. */
export function botModelDemand(bot: SettingsAgent | undefined, principalId: string, catalog: readonly NormalizedSkill[] = []) {
    const tasks = new Set<TaskId>();
    const tools = new Set<string>();
    if (Array.isArray(bot?.tool_ids)) for (const id of bot.tool_ids) if (typeof id === 'string') tools.add(id);
    const unknown: string[] = [];
    const assigned: string[] = [];
    const owner = bot?.managed_by?.startsWith('builtin:') ? bot.managed_by.slice(8) : '';
    for (const task of plugins[owner] ?? []) tasks.add(task);
    if (bot?.id === principalId) tasks.add('workflow');
    for (const id of new Set([...(bot?.skill_ids ?? []), ...requiredSkillIdsForAgent(bot, catalog)])) {
        const skill = catalog.find(item => item.id === id);
        assigned.push(skill?.name || id);
        for (const tool of skill?.toolIds ?? []) tools.add(tool);
        const ids = [id, skill?.metadata?.derived_from?.id ?? ''];
        const inferred = ids.flatMap(key => skills[key] ?? (key.startsWith('core.gnosi-operation-')
            ? operations[key.slice('core.gnosi-operation-'.length)] ?? [] : key.startsWith('plugin.llm-wiki.') ? plugins['llm-wiki'] ?? [] : []));
        for (const task of inferred) tasks.add(task);
        if (!inferred.length) unknown.push(skill?.name || id);
    }
    if (bot?.team?.enabled) {
        if (bot.team.director_id === bot.id) tasks.add('workflow');
        for (const route of bot.team.direct_routes) if (route.agent_ids.includes(bot.id)) {
            for (const task of operations[route.operation] ?? []) tasks.add(task);
        }
    }
    if (!tasks.size) tasks.add(botTask(bot, principalId));
    return { tasks: [...tasks], tools: [...tools], assigned, unknown,
        needsTools: tools.size > 0 || tasks.has('workflow') || tasks.has('code') };
}
