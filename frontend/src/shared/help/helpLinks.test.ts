import { describe, expect, it } from 'vitest';
import { contextualHelpTopic, helpLocale, helpUrl } from './helpLinks';

describe('help destinations', () => {
    it.each(['light', 'dark', 'system'] as const)('carries the %s preference to localized help', theme => {
        expect(helpUrl('ca', 'getting-started', false, theme)).toBe(`https://gnosi.temenosismael.org/Gnosi/learn/ca/getting-started/?theme=${theme}`);
    });
    it.each([['ca-ES', 'ca'], [' ES_es ', 'es'], ['fr-CA', 'fr'], ['de', 'en'], ['', 'en']])(
        'resolves %s to %s', (language, expected) => { expect(helpLocale(language)).toBe(expected); },
    );
    it.each([
        ['/@research/knowledge/table/t1/view/v1', 'databases-planning'],
        ['/vault/table/t1', 'databases-planning'],
        ['/@research/knowledge/document', 'reading-references'],
        ['/vault/pdf', 'reading-references'],
        ['/vault/page/12', 'pages-files'], ['/@research/knowledge/page/12', 'pages-files'],
        ['/literature', 'reading-references'], ['/@research/resources', 'reading-references'],
        ['/scheduler', 'integrations-automations'], ['/@research/automations', 'integrations-automations'],
        ['/social-dashboard', 'publishing-media'], ['/composer', 'publishing-media'],
        ['/@research/social/compose', 'publishing-media'], ['/planning', 'databases-planning'],
        ['/graph', 'graph-genograms'], ['/@research/notebooks/42', 'notebooks'],
        ['/mail', 'mail-calendar-contacts'], ['/calendar', 'mail-calendar-contacts'],
        ['/contacts', 'mail-calendar-contacts'], ['/media', 'publishing-media'], ['/unknown', ''],
    ])('maps %s without disclosing record identity', (path, expected) => {
        expect(contextualHelpTopic(path)).toBe(expected);
        expect(helpUrl('fr', contextualHelpTopic(path))).not.toContain('research');
    });
    it('uses localized articles and a safe root for unrecognized topics', () => {
        expect(helpUrl('ca', 'getting-started')).toBe('https://gnosi.temenosismael.org/Gnosi/learn/ca/getting-started/');
        expect(helpUrl('de', '../secrets')).toBe('https://gnosi.temenosismael.org/Gnosi/learn/');
        expect(helpUrl('es', '', true)).toBe('https://gnosi.temenosismael.org/Gnosi/engineering/es/');
    });
});
