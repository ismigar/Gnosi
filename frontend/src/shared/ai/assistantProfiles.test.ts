import { describe, expect, it } from 'vitest';
import { principalAssistant } from './assistantProfiles';
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
});
