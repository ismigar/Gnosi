import {describe, expect, it} from 'vitest';
import i18next from 'i18next';
import {formatFrequency, normalizeMember, ROLE_CAPABILITIES} from './model';

describe('dashboard model', () => {
    it('preserves day, hour, fractional hour, minute and legacy second frequencies', async () => {
        const i18n = i18next.createInstance();
        await i18n.init({lng: 'en', resources: {en: {translation: {dashboard: {
            frequency_days: '{{count}} days', frequency_hours: '{{count}} hours',
            frequency_minutes: '{{count}} minutes', frequency_seconds: '{{count}} seconds',
            frequency_none: 'none',
        }}}}});
        for (const [minutes, expected] of [[1440, '1 days'], [120, '2 hours'], [90, '1.5 hours'], [15, '15 minutes']] as const) {
            expect(formatFrequency({interval_minutes: minutes}, i18n.t)).toBe(expected);
        }
        expect(formatFrequency({interval_minutes: 0, interval: 25}, i18n.t)).toBe('25 seconds');
        expect(formatFrequency({interval_minutes: 0}, i18n.t)).toBe('none');
    });
    it('narrows open permission JSON while preserving custom permission fields', () => {
        const member = normalizeMember({user_id: 'fixture', email: 'member@example.test', role: 'editor',
            joined_at: '2026-08-01', permissions: {capabilities: ['read', 5, 'write'], custom: true}});
        expect(member.permissions).toEqual({capabilities: ['read', 'write'], custom: true});
        expect(ROLE_CAPABILITIES.owner).toEqual(['read','write','delete','admin','analytics','tools']);
        expect(normalizeMember({...member, permissions: null}).permissions).toBeNull();
    });
});
