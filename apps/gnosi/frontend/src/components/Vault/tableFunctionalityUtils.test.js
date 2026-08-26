import { describe, expect, it } from 'vitest';

import { normalizeTableFunctionalities } from './tableFunctionalityUtils';

describe('table functionality normalization', () => {
    it('converts legacy button fields without losing their configuration', () => {
        const schema = {
            title: 'title',
            Complete: 'button',
            Complete_config: {
                id: 'fld_12345678',
                button_action: 'set_fields',
                button_label: 'Complete task',
                button_config: { assignments: [{ field: 'Status', value: 'Done' }] },
            },
            Status: 'status',
        };

        expect(normalizeTableFunctionalities([], schema)).toEqual([{
            id: 'legacy_fld_12345678',
            enabled: true,
            label: 'Complete task',
            action: 'set_fields',
            config: { assignments: [{ field: 'Status', value: 'Done' }] },
        }]);
    });

    it('does not duplicate a legacy functionality after it has been persisted', () => {
        const schema = {
            Translate: 'button',
            Translate_config: { id: 'fld_abcdef12', button_action: 'translate_row' },
        };
        const persisted = [{
            id: 'legacy_fld_abcdef12',
            enabled: false,
            label: 'Translate later',
            action: 'translate_row',
            config: {},
        }];

        expect(normalizeTableFunctionalities(persisted, schema)).toEqual(persisted);
    });
});
