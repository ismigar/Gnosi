import { expect, it } from 'vitest';
import { normalizeSkill } from '../AI/aiSettingsUtils';
import { botModelDemand } from './botModelDemand';

it('combines plugin responsibilities with all known assigned operations', () => {
    const demand = botModelDemand({ id: 'wiki', managed_by: 'builtin:llm-wiki', skill_ids: ['core.gnosi-operation-mail'] }, 'principal');
    expect(demand.tasks).toEqual(['book', 'retrieve', 'analyse', 'classify', 'extract']);
});
it('uses the ancestry and actual tool dependencies of personalized skills', () => {
    const skill = normalizeSkill({ id: 'custom', name: 'My mail', tool_ids: ['mail.read'], metadata: { derived_from: { id: 'core.gnosi-inbox-triage', name: '', version: '', revision: '', instructions: '', tool_ids: [] } } });
    const demand = botModelDemand({ id: 'a', skill_ids: ['custom'] }, 'principal', [skill]);
    expect(demand.tasks).toEqual(['classify', 'extract']);
    expect(demand.tools).toEqual(['mail.read']); expect(demand.needsTools).toBe(true); expect(demand.unknown).toEqual([]);
});
it('shows unknown assignments instead of inferring from arbitrary names or instructions', () => {
    const demand = botModelDemand({ id: 'a', skill_ids: ['custom'] }, '', [normalizeSkill({ id: 'custom', name: 'Code expert', instructions: 'Write code', tool_ids: ['run'] })]);
    expect(demand.unknown).toEqual(['Code expert']); expect(demand.tasks).toEqual(['analyse']); expect(demand.needsTools).toBe(true);
});
it('includes coordination and enabled team routes without changing the bot', () => {
    const bot = { id: 'principal', skill_ids: [], team: { version: 1 as const, enabled: true, director_id: 'principal', members: [], direct_routes: [{ operation: 'tables', agent_ids: ['principal'] }], temporary: { enabled: false, models: [], skill_ids: [] } } };
    expect(botModelDemand(bot, 'principal').tasks).toEqual(['workflow', 'extract']); expect(bot.skill_ids).toEqual([]);
});
it('includes required skills and explicit tool assignments', () => {
    const skill = normalizeSkill({ id: 'core.gnosi-operation-tables', required_agent_ids: ['a'], tool_ids: ['table.write'] });
    const demand = botModelDemand({ id: 'a', tool_ids: ['search'] }, '', [skill]);
    expect(demand.tasks).toEqual(['extract']); expect(demand.tools).toEqual(['search', 'table.write']);
});
it('recognizes the principal’s personalized foundational Gnosi skills', () => {
    const ids = ['core.gnosi-vault', 'core.gnosi-jobs', 'core.gnosi-activity', 'core.gnosi-contacts', 'core.gnosi-planning'];
    const catalog = ids.map(id => normalizeSkill({ id: `custom-${id}`, tool_ids: [`${id}.tool`], metadata: { derived_from: { id, name: '', version: '', revision: '', instructions: '', tool_ids: [] } } }));
    const demand = botModelDemand({ id: 'principal', skill_ids: catalog.map(item => item.id) }, 'principal', catalog);
    expect(demand.unknown).toEqual([]);
    expect(demand.tasks).toEqual(['workflow', 'classify', 'extract', 'retrieve', 'analyse']);
    expect(demand.tools).toHaveLength(5);
});
it('distinguishes actual specialist functions instead of making all bots general analysts', () => {
    const pairs = [['translation', ['translate']], ['calendar', ['calendar', 'synthesize']],
        ['resources', ['research']], ['social-publishing', ['write']]] as const;
    for (const [plugin, tasks] of pairs) expect(botModelDemand({ id: plugin, managed_by: `builtin:${plugin}` }, 'principal').tasks).toEqual(tasks);
});
