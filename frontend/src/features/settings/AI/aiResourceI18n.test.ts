import i18next, { type Resource, type TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import ca from '../../../shared/i18n/locales/ca/translation.json';
import en from '../../../shared/i18n/locales/en/translation.json';
import es from '../../../shared/i18n/locales/es/translation.json';
import fr from '../../../shared/i18n/locales/fr/translation.json';
import {
    operationStatusLabel,
    resourceRoleLabel,
    skillDisplayDescription,
    skillDisplayInstructions,
    skillDisplayName,
    skillCategory,
    toolDisplayDescription,
    toolDisplayName,
} from './aiResourceI18n';

const resources: Resource = {
    ca: { translation: ca },
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
};

const translator = async (language: string): Promise<TFunction> => {
    const instance = i18next.createInstance();
    await instance.init({
        lng: language,
        fallbackLng: 'en',
        resources,
    });
    return instance.t.bind(instance);
};

const calendarSkill = {
    id: 'core.gnosi-calendar',
    name: 'Gnosi Calendar',
    description: 'Provider-neutral first-party Gnosi Calendar operations.',
    instructions: 'Use only configured personal-workspace calendars.',
    origin: { type: 'core', id: 'gnosi' },
    metadata: { domain: 'calendar' },
};

const createCalendarTool = {
    id: 'core.gnosi.create-calendar-event',
    name: 'Create Calendar Event',
    description: 'Prepare an external calendar event and wait for confirmation.',
    origin: { type: 'core', id: 'gnosi' },
    metadata: { domain: 'calendar' },
};

describe('AI resource presentation localization', () => {
    it.each([
        ['ca', 'Gnosi · Calendaris', 'Crea un esdeveniment del calendari', 'editor', 'Completada'],
        ['en', 'Gnosi · Calendar', 'Create a calendar event', 'editor', 'Completed'],
        ['es', 'Gnosi · Calendario', 'Crea un evento del calendario', 'editor', 'Completada'],
        ['fr', 'Gnosi · Calendrier', 'Créer un événement du calendrier', 'éditeur', 'Terminée'],
    ])('localizes bundled resources and enums in %s', async (
        language,
        expectedSkill,
        expectedTool,
        expectedRole,
        expectedStatus,
    ) => {
        const t = await translator(language);
        expect(skillDisplayName(t, calendarSkill)).toBe(expectedSkill);
        expect(skillDisplayDescription(t, calendarSkill)).not.toContain('Provider-neutral');
        expect(skillDisplayInstructions(t, calendarSkill)).toBe(calendarSkill.instructions);
        expect(toolDisplayName(t, createCalendarTool)).toBe(expectedTool);
        expect(toolDisplayDescription(t, createCalendarTool)).toBe(t('settings.ai.catalog.tool_descriptions.create_calendar_event'));
        expect(resourceRoleLabel(t, 'editor')).toBe(expectedRole);
        expect(operationStatusLabel(t, 'completed')).toBe(expectedStatus);
    });

    it.each(['ca', 'en', 'es', 'fr'])('distinguishes operations with the same verb in %s', async language => {
        const t = await translator(language);
        const names = ['add-page-comment', 'add-tags', 'create-page', 'create-table-row', 'read-mail-message', 'read-mail-thread'].map(id => toolDisplayName(t, { id: `core.gnosi.${id}`, origin: { type: 'core' } }));
        expect(new Set(names).size).toBe(names.length);
        expect(names.every(name => !name.startsWith('core.'))).toBe(true);
        const external = { name: 'Specific connector action', description: 'Reads the selected connector record.', origin: { type: 'plugin', id: 'custom' } };
        expect(toolDisplayDescription(t, external)).toBe(external.description);
    });

    it('preserves user-authored skill content' , async () => {
        const t = await translator('ca');
        const personal = {
            id: 'user.custom',
            name: 'My research method',
            description: 'Keep this wording.',
            instructions: 'Follow my checklist.',
            origin: { type: 'user' },
        };
        expect(skillDisplayName(t, personal)).toBe(personal.name);
        expect(skillDisplayDescription(t, personal)).toBe(personal.description);
        expect(skillDisplayInstructions(t, personal)).toBe(personal.instructions);
    });

    it.each(['ca', 'en', 'es', 'fr'])('presents newly assignable feature domains in %s', async language => {
        const t = await translator(language);
        for (const [domain, toolId] of [
            ['notebooks', 'notebook-list'],
            ['literature', 'literature-start-search'],
            ['media', 'media-search'],
            ['activity', 'activity-read-runs'],
        ] as const) {
            const skill = { id: `core.gnosi-${domain}`, origin: { type: 'core', id: 'gnosi' }, metadata: { domain } };
            const tool = { id: `core.gnosi.${toolId}`, origin: skill.origin, metadata: skill.metadata };
            expect(skillDisplayName(t, skill)).toBe(`Gnosi · ${t(`settings.ai.catalog.domains.${domain}`)}`);
            expect(skillDisplayDescription(t, skill)).toBe(t(`settings.ai.catalog.skill_descriptions.core_gnosi_${domain}`));
            expect(toolDisplayName(t, tool)).toBe(t(`settings.ai.catalog.tool_names.${toolId.replaceAll('-', '_')}`));
            expect(toolDisplayDescription(t, tool)).toBe(t(`settings.ai.catalog.tool_descriptions.${toolId.replaceAll('-', '_')}`));
        }
    });
});

it.each(['ca', 'en', 'es', 'fr'])('distinguishes application procedures from Vault tools in %s', async language => {
    const t = await translator(language);
    const vault = { id: 'core.gnosi-vault', origin: { type: 'core' } };
    const names = ['writing', 'tables', 'knowledge', 'learning'].map(operation => {
        const skill = { id: `core.gnosi-operation-${operation}`, origin: { type: 'core' } };
        const name = skillDisplayName(t, skill);
        expect(name).not.toBe(skillDisplayName(t, vault));
        expect(name).not.toContain('core.');
        expect(skillDisplayDescription(t, skill)).not.toBe('');
        expect(skillCategory(skill)).toBe('workflow');
        return name;
    });
    expect(new Set(names).size).toBe(4);
});
