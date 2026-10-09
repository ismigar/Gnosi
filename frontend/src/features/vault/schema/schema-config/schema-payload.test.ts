import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { hydrateFields } from './hydrate-fields';
import { buildPayload } from './schema-payload';
import { buildSchemaFromTableProperties } from '../../../../shared/records/model/schemaUtils';

it('round-trips plugin bindings, catalogs and imported UUID field IDs through the schema editor', () => {
    const schema = buildSchemaFromTableProperties([{ id: 'a32d7804-a606-42d3-ad85-5de4d5391e06',
        name: 'Verification', type: 'select', config: {
            plugin_roles: { 'llm-wiki': 'verification' },
            plugin_option_values: { provisional: 'Provisional' },
            options: [{ name: 'Provisional', color: 'gray' }],
        },
    }]);
    const fields = hydrateFields(schema, null);
    expect(fields[0]?.requiredBy).toEqual(['llm-wiki']);
    if (fields[0]) fields[0].name = 'Evidence status';
    expect(buildPayload(fields, false).newSchemaObj['Evidence status_config']).toMatchObject({
        id: 'a32d7804-a606-42d3-ad85-5de4d5391e06',
        plugin_roles: { 'llm-wiki': 'verification' },
        plugin_option_values: { provisional: 'Provisional' },
    });
});
import { readActionConfig } from './readers';
import { validateSchema } from './validate-schema';
import { normalizeTableFunctionalities } from '../../properties/tableFunctionalityUtils';

describe('schema configuration persistence contracts', () => {
    it('persists an explicitly empty local status catalog after deleting its last option', () => {
        const fields = hydrateFields({ Status: 'status', Status_config: { id: 'fld_00000002', options: ['Open'] } }, null);
        const status = fields[0];
        if (!status) throw new Error('Missing status field');
        status.options = [];
        expect(buildPayload(fields, false).newSchemaObj.Status_config).toEqual({ id: 'fld_00000002', options: [] });
    });
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
            Status: 'status', Status_config: { id: 'fld_00000002', catalog_ref: 'status', options: ['Open'], default_option: 'Outside' },
            Tags: 'multi_select', Tags_config: { id: 'fld_00000003', options: ['one'], default_option: 'missing' },
        }, null);
        expect(buildPayload(fields, false).newSchemaObj).toEqual({
            Status: 'status', Status_config: { id: 'fld_00000002', catalog_ref: 'status', default_option: 'Outside' },
            Tags: 'multi_select', Tags_config: { id: 'fld_00000003', options: [expect.objectContaining({ name: 'one' })] },
        });
    });

    it('keeps independent status options when hydrating and saving two tables', () => {
        for (const names of [['Pending', 'Done'], ['Accepted', 'Rejected']]) {
            const fields = hydrateFields({ Status: 'status', Status_config: { id: 'fld_00000002', options: names } }, null);
            expect(fields[0]?.catalogRef).toBe('');
            expect(buildPayload(fields, false).newSchemaObj.Status_config).toMatchObject({
                id: 'fld_00000002', options: names.map(name => ({ name })),
            });
        }
    });

    it('round-trips rollup, relation, virtual, period, file and display-format payloads', () => {
        const schema = {
            Links: 'relation', Links_config: { id: 'fld_00000001', relation_database_id: 'other', cardinality: 'many-to-one' },
            Total: 'rollup', Total_config: { id: 'fld_00000002', relationField: 'Links', targetProperty: 'Cost', aggregation: 'sum', format: { display: 'bar' }, limit: 4, fallbackValue: 'none' },
            Count: 'rollup', Count_config: { id: 'fld_00000003', relationField: 'Links', aggregation: 'count_all' },
            File: 'files', File_config: { id: 'fld_00000004', file_mode: 'upload', storage_folder: 'library', name_pattern: '{Title}' },
            Price: 'number', Price_config: { id: 'fld_00000005', format: { kind: 'currency', display: 'number', decimals: 2, currency: 'EUR (€)' } },
            Day: 'date', Day_config: { id: 'fld_00000006', format: { dateFormat: 'YYYY-MM-DD' } },
            Period: 'period', Period_config: { id: 'fld_00000007', duration_enabled: false, predecessors_enabled: true, skip_non_working_days: false, period_unit: 'hours' },
            Derived: 'virtual', Derived_config: { id: 'fld_00000008', compute: 'graph.degree' },
            Formula: 'formula', Formula_config: { id: 'fld_00000009', formula: '{Price} * 2', defaultFormula: 'today()', format: { kind: 'percent', display: 'ring', progressMax: 1 } },
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

    it('preserves the source-section relation when editing its name', () => {
        const fields = hydrateFields({ Apartat: 'relation', Apartat_config: {
            id: 'fld_00000004', relation_database_id: 'sections', cardinality: 'many-to-one', source_sections: true,
        } }, ['Apartat']);
        const section = fields[0];
        if (!section) throw new Error('Missing section field');
        section.name = 'Chapter';
        expect(buildPayload(fields, false).newSchemaObj.Chapter_config).toEqual({
            id: 'fld_00000004', relation_database_id: 'sections', cardinality: 'many-to-one', source_sections: true,
        });
    });
});
