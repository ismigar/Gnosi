import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import ca from '../../../shared/i18n/locales/ca/translation.json';
import { systemRunResult } from './activityHistoryPresentation';

describe('system run explanations', () => {
    it('does not claim a publication happened when only success was recorded', async () => {
        const i18n = createInstance();
        await i18n.init({ lng: 'ca', resources: { ca: { translation: ca } } });
        const run = { id: 'run', task_name: 'publish_scheduled_social', status: 'success', message: 'Task publish_scheduled_social completed successfully.', description: null, started_at: null, finished_at: null, duration_seconds: 0 };
        const text = systemRunResult(i18n.t, run, 'Publicació a xarxes');
        expect(text).toContain('Publicació a xarxes');
        expect(text).toContain('no especifica');
        expect(text).not.toContain('publish_scheduled_social');
        expect(systemRunResult(i18n.t, { ...run, message: 'Completed: 2/3 subtasks succeeded.' }, 'Publicació a xarxes')).toBe('2 de 3 operacions completades correctament.');
        expect(systemRunResult(i18n.t, { ...run, message: '3 publicacions enviades.' }, 'Publicació a xarxes')).toBe('3 publicacions enviades.');
        expect(systemRunResult(i18n.t, { ...run, status: 'failed', message: 'INTERNAL_ERROR' }, 'Publicació a xarxes')).toContain('no ha pogut completar');
    });
});
