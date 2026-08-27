import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import ca from '../../locales/ca/translation.json';
import en from '../../locales/en/translation.json';
import es from '../../locales/es/translation.json';
import fr from '../../locales/fr/translation.json';
import {
    operationStatusLabel,
    resourceRoleLabel,
    skillDisplayDescription,
    skillDisplayInstructions,
    skillDisplayName,
    toolDisplayDescription,
    toolDisplayName,
} from './aiResourceI18n';

const catalogs = { ca, en, es, fr };

const translator = async language => {
    const instance = i18next.createInstance();
    await instance.init({
        lng: language,
        fallbackLng: 'en',
        resources: Object.fromEntries(Object.entries(catalogs).map(([locale, translation]) => (
            [locale, { translation }]
        ))),
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
        ['ca', 'Gnosi · Calendaris', 'Crea · Calendaris', 'editor', 'Completada'],
        ['en', 'Gnosi · Calendar', 'Create · Calendar', 'editor', 'Completed'],
        ['es', 'Gnosi · Calendario', 'Crear · Calendario', 'editor', 'Completada'],
        ['fr', 'Gnosi · Calendrier', 'Créer · Calendrier', 'éditeur', 'Terminée'],
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
        expect(skillDisplayInstructions(t, calendarSkill)).not.toContain('personal-workspace');
        expect(toolDisplayName(t, createCalendarTool)).toBe(expectedTool);
        expect(toolDisplayDescription(t, createCalendarTool)).not.toContain('external calendar');
        expect(resourceRoleLabel(t, 'editor')).toBe(expectedRole);
        expect(operationStatusLabel(t, 'completed')).toBe(expectedStatus);
    });

    it('preserves user-authored skill content', async () => {
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
});
