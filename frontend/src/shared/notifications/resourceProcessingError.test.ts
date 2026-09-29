import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import ca from '../i18n/locales/ca/translation.json';
import en from '../i18n/locales/en/translation.json';
import es from '../i18n/locales/es/translation.json';
import fr from '../i18n/locales/fr/translation.json';
import { resourceProcessingError } from './resourceProcessingError';

describe('resource processing errors', () => {
    it.each(Object.entries({ ca, en, es, fr }))('localizes provider timeouts in %s', async (lng, translation) => {
        const i18n = createInstance();
        await i18n.init({ lng, resources: { [lng]: { translation } } });
        expect(resourceProcessingError(
            'The AI provider did not respond in time. Retry to resume saved progress.', i18n.t,
        )).toBe(translation.llm_wiki.error_provider_timeout);
        expect(resourceProcessingError('', i18n.t)).toBe(translation.llm_wiki.error_generic);
        expect(resourceProcessingError('Provider unavailable (503)', i18n.t)).toBe('Provider unavailable (503)');
    });
});
