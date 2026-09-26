import { describe, expect, it } from 'vitest';
import { principalAssistant, profilesByDisplayName } from './assistantProfiles';
describe('principal assistant', () => {
    const profiles = [{ id: 'disabled', enabled: false }, { id: 'first' }, { id: 'chosen', enabled: true }];
    it('uses the configured principal regardless of ordering', () => {
        expect(principalAssistant(profiles, 'chosen')?.id).toBe('chosen');
    });
    it('supports older configurations without a principal', () => {
        expect(principalAssistant(profiles)?.id).toBe('first');
        expect(principalAssistant([{ id: 'disabled', enabled: false }])).toBeUndefined();
    });
    it('does not silently replace a missing or disabled explicit selection', () => {
        expect(principalAssistant(profiles, 'missing')).toBeUndefined();
        expect(principalAssistant(profiles, 'disabled')?.enabled).toBe(false);
    });
    it('does not select the retired managed Knowledge profile', () => {
        const legacy = { id: 'llm-wiki', managed_by: 'llm-wiki' };
        expect(principalAssistant([legacy, { id: 'personal' }])?.id).toBe('personal');
        expect(principalAssistant([legacy], 'llm-wiki')).toBeUndefined();
    });
});

it('sorts translated display names without changing stored routing order', () => {
    const profiles = [
        { id: 'writing', name: 'Writing and knowledge capture', managed_by: 'builtin:ai-platform' },
        { id: 'z', name: 'Zebra' },
        { id: 'a', name: 'Àbac' },
    ];
    const translate = (key: string, options: { defaultValue: string }) =>
        key === 'settings.ai.assistant.builtin_profiles.ai-platform' ? 'Escriptura' : options.defaultValue;
    expect(profilesByDisplayName(profiles, translate, 'ca').map(p => p.id)).toEqual(['a', 'writing', 'z']);
    expect(profiles.map(p => p.id)).toEqual(['writing', 'z', 'a']);
});
