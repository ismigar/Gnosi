import { describe, expect, it } from 'vitest';
import { principalAssistant, profileDisplayName } from './assistantProfiles';
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

const t = (key: string) => `translated:${key}`;
it('translates shipped names but preserves personal, customized and third-party names', () => {
    expect(profileDisplayName({ name: 'Mail', managed_by: 'builtin:mail' }, t)).toBe('translated:settings.ai.assistant.builtin_profiles.mail');
    expect(profileDisplayName({ name: 'My mail', managed_by: 'builtin:mail' }, t)).toBe('My mail');
    expect(profileDisplayName({ name: 'Mail', managed_by: 'plugin:mail' }, t)).toBe('Mail');
    expect(profileDisplayName({ name: 'Mail' }, t)).toBe('Mail');
});
