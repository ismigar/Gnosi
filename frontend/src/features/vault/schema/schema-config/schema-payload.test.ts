import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { hydrateFields } from './hydrate-fields';
import { buildPayload } from './schema-payload';
import { readActionConfig } from './readers';
import { validateSchema } from './validate-schema';
import { normalizeTableFunctionalities } from '../../properties/tableFunctionalityUtils';

describe('schema configuration persistence contracts', () => {
    it('keeps stable IDs, unmanaged plugin config, column order and visibility when renaming', () => {
        const extension = { nested: [1, 'opaque', false], plugin: 'sample' };
        const schema = {
            Title: 'title', Title_config: { id: 'fld_00000001' },
            Status: 'select', Status_config: {
                id: 'fld_00000002', role: 'status', option_groups: ['Initial', 'Final'], extension,
                options: [{ name: 'Open', color: 'blue', group: 'Initial' }], default_option: 'Open',
            },
        };
        const fields = hydrateFields(schema, ['Status']);
        const status = fields[1];
        if (!status) throw new Error('Missing test field');
        status.name = '  State  ';
        const saved = buildPayload(fields, false);
        expect(saved.visibleProperties).toEqual(['State']);
        expect(Object.keys(saved.newSchemaObj)).toEqual(['Title', 'Title_config', 'State', 'State_config']);
        expect(saved.newSchemaObj.State_config).toEqual(schema.Status_config);
        expect(schema.Status_config.id).toBe('fld_00000002');
        expect(hydrateFields(saved.newSchemaObj, saved.visibleProperties).map((field) => field.id))
            .toEqual(['fld_00000001', 'fld_00000002']);
    });

    it('persists global status references without copying catalogs and retains shared defaults', () => {
        const fields = hydrateFields({
            Status: 'status', Status_config: { id: 'fld_00000002', options: ['Open'], default_option: 'Outside' },
            Tags: 'multi_select', Tags_config: { id: 'fld_00000003', options: ['one'], default_option: 'missing' },
        }, null);
        expect(buildPayload(fields, false).newSchemaObj).toEqual({
            Status: 'status', Status_config: { id: 'fld_00000002', catalog_ref: 'status', default_option: 'Outside' },
            Tags: 'multi_select', Tags_config: { id: 'fld_00000003', options: [expect.objectContaining({ name: 'one' })] },
        });
    });

    it('round-trips rollup, relation, virtual, period, file and display-format payloads', () => {
        const schema = {
            Links: 'relation', Links_config: { id: 'fld_00000001', relation_database_id: 'other', cardinality: 'many-to-one' },
            Total: 'rollup', Total_config: { id: 'fld_00000002', relationField: 'Links', targetProperty: 'Cost', aggregation: 'sum', limit: 4, fallbackValue: 'none' },
            Count: 'rollup', Count_config: { id: 'fld_00000003', relationField: 'Links', aggregation: 'count_all' },
            File: 'files', File_config: { id: 'fld_00000004', file_mode: 'upload', storage_folder: 'library', name_pattern: '{Title}' },
            Price: 'number', Price_config: { id: 'fld_00000005', format: { kind: 'currency', decimals: 2, currency: 'EUR (€)' } },
            Day: 'date', Day_config: { id: 'fld_00000006', format: { dateFormat: 'YYYY-MM-DD' } },
            Period: 'period', Period_config: { id: 'fld_00000007', duration_enabled: false, predecessors_enabled: true, skip_non_working_days: false, period_unit: 'hours' },
            Derived: 'virtual', Derived_config: { id: 'fld_00000008', compute: 'graph.degree' },
            Formula: 'formula', Formula_config: { id: 'fld_00000009', formula: '{Price} * 2', defaultFormula: 'today()' },
        };
        expect(buildPayload(hydrateFields(schema, null), false).newSchemaObj).toEqual(schema);
    });

    it('converts legacy buttons once and preserves functionality config including extension keys', () => {
        const config = { assignments: [{ field: 'Tags', value: ['a', 'b'] }], plugin: { id: 'plugin-1' } };
        const schema = { Translate: 'button', Translate_config: { id: 'fld_00000001', button_label: 'Assign', button_action: 'set_fields', button_config: config } };
        const functions = normalizeTableFunctionalities([{ id: 'fn_saved', label: 'Custom', action: 'run_skill', config: { skill_id: 'test', extra: 1 } }], schema);
        expect(functions.map((entry) => ({ ...entry, config: readActionConfig(entry.config) }))).toEqual([
            { id: 'fn_saved', label: 'Custom', action: 'run_skill', enabled: true, config: { skill_id: 'test', extra: 1 } },
            { id: 'legacy_fld_00000001', label: 'Assign', action: 'set_fields', enabled: true, config },
        ]);
    });

    it('blocks incomplete rollups except count_all, and incomplete translations', async () => {
        const i18n = createInstance();
        await i18n.init({ lng: 'en', resources: {}, initImmediate: false });
        const fields = hydrateFields({ Count: 'rollup', Count_config: { relationField: 'Links', aggregation: 'count_all' } }, null);
        expect(validateSchema(fields, [], false, i18n.t)).toBeNull();
        expect(validateSchema(fields, [], true, i18n.t)).toContain('mark at least one field');
        const field = fields[0];
        if (!field) throw new Error('Missing test field');
        field.aggregation = 'sum';
        expect(validateSchema(fields, [], false, i18n.t)).toBe('schema.error_target_property_required');
        expect(field.id).toMatch(/^fld_[0-9a-f]{8}$/);
    });
});
