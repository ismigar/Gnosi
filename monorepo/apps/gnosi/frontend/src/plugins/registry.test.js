import { describe, expect, it } from 'vitest';

import ca from '../locales/ca/translation.json';
import en from '../locales/en/translation.json';
import es from '../locales/es/translation.json';
import fr from '../locales/fr/translation.json';

import {
    BUILTIN_PLUGIN_BY_ID,
    BUILTIN_PLUGINS,
    pluginForPath,
} from './registry';

describe('built-in capability registry', () => {
    it('keeps every optional capability explicit and unique', () => {
        expect(BUILTIN_PLUGINS).toHaveLength(18);
        expect(new Set(BUILTIN_PLUGINS.map((plugin) => plugin.id)).size).toBe(18);
        expect(BUILTIN_PLUGIN_BY_ID['grounded-notebooks'].requires).toEqual(['ai-platform']);
        expect(BUILTIN_PLUGIN_BY_ID['llm-wiki'].requires).toEqual(['ai-platform']);
    });

    it('maps protected routes before their lazy package is rendered', () => {
        expect(pluginForPath('/mail')).toBe('mail');
        expect(pluginForPath('/media')).toBe('social-publishing');
        expect(pluginForPath('/notebooks/example')).toBe('grounded-notebooks');
        expect(pluginForPath('/vault')).toBeNull();
    });

    it('provides a localized catalogue entry for every built-in capability', () => {
        for (const catalogue of [ca, en, es, fr]) {
            for (const plugin of BUILTIN_PLUGINS) {
                const entry = catalogue.settings?.plugins?.catalog?.[plugin.id];
                expect(entry?.name, `${plugin.id} name`).toBeTruthy();
                expect(entry?.description, `${plugin.id} description`).toBeTruthy();
            }
        }
    });
});
