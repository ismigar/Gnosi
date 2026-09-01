import { describe, expect, it } from 'vitest';

import { resolveSystemDateValue, withResolvedSystemDates } from './schemaUtils';
const schema = {
    Title: 'title',
    'Data de creació': 'created_time',
    'Data de creació_config': { id: 'fld_created' },
    'Última modificació': 'last_edited_time',
    'Última modificació_config': { id: 'fld_modified' },
};

describe('Vault system date resolution', () => {
    it('prefers registered record dates over rewritten filesystem timestamps', () => {
        const page = {
            created_time: '2026-08-10T19:01:10.000Z',
            last_modified: '2026-08-10T19:01:10.000Z',
            metadata: {
                'Data de creació': '2025-05-16T14:41:00.000Z',
                'Última modificació': '2025-12-31T16:32:00.000Z',
            },
        };

        expect(resolveSystemDateValue(page, schema, 'created_time'))
            .toBe('2025-05-16T14:41:00.000Z');
        expect(resolveSystemDateValue(page, schema, 'last_edited_time'))
            .toBe('2025-12-31T16:32:00.000Z');
        expect(withResolvedSystemDates(page, schema)).toMatchObject({
            created_time: '2025-05-16T14:41:00.000Z',
            last_modified: '2025-12-31T16:32:00.000Z',
        });
    });

    it('supports stable field IDs and falls back to authorship timestamps', () => {
        const page = {
            created_time: '2026-08-10T19:01:10.000Z',
            last_modified: '2026-08-10T19:01:10.000Z',
            metadata: {
                fld_modified: '2024-03-04T05:06:00.000Z',
                created_at: '2023-01-02T03:04:00.000Z',
            },
        };

        expect(resolveSystemDateValue(page, schema, 'last_edited_time', 'fld_modified'))
            .toBe('2024-03-04T05:06:00.000Z');
        expect(resolveSystemDateValue(page, schema, 'created_time'))
            .toBe('2023-01-02T03:04:00.000Z');
    });

    it('uses filesystem timestamps only when no stored system date exists', () => {
        const page = {
            created_time: '2020-01-01T00:00:00.000Z',
            last_modified: '2020-01-02T00:00:00.000Z',
            metadata: {},
        };

        expect(resolveSystemDateValue(page, {}, 'created_time')).toBe(page.created_time);
        expect(resolveSystemDateValue(page, {}, 'last_edited_time')).toBe(page.last_modified);
        expect(withResolvedSystemDates(page, {})).toBe(page);
    });
});
