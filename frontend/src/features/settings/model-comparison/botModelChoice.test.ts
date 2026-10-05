import { expect, it } from 'vitest';
import { botTask, withBotModel } from './botModelChoice';
import type { SettingsAgent } from '../global-settings/types';

it('changes only model selection and resets reasoning on a different route', () => {
    const bot: SettingsAgent = { id: 'knowledge', name: 'Knowledge', provider: 'old', model: 'one', reasoning_effort: 'low',
        persona: 'Read faithfully', skill_ids: ['reading'], context: 'Preserve quotes', enabled: false,
        model_strategy: { schema_version: 1, mode: 'adaptive', decision_engine: 'rules', allowed_models: [] } };
    const next = withBotModel(bot, 'new', 'two');
    expect(next).toEqual({ ...bot, provider: 'new', model: 'two', reasoning_effort: null,
        model_strategy: { schema_version: 1, mode: 'pinned', decision_engine: 'rules', allowed_models: [] } });
    expect(bot.model).toBe('one');
    expect(withBotModel(bot, 'old', 'one').reasoning_effort).toBe('low');
});

it('uses book reading for Knowledge and sequential workflows for the principal', () => {
    expect(botTask({ id: 'wiki', managed_by: 'builtin:llm-wiki' }, 'principal')).toBe('book');
    expect(botTask({ id: 'principal' }, 'principal')).toBe('workflow');
    expect(botTask({ id: 'mail', managed_by: 'builtin:mail' }, 'principal')).toBe('extract');
});
