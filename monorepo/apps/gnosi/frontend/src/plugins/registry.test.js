import { describe, expect, it } from 'vitest';

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
});
