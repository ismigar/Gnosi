import { describe, expect, it } from 'vitest';

import {
    buildSchemaFromTableProperties,
    buildTablePropertiesFromSchema,
    detectRecordSourceLang,
    discoverFieldNamesFromRecords,
    getFieldConfig,
    getFieldId,
    getFieldNameById,
    getFieldType,
    getLanguageFieldName,
    getMetaValue,
    getSchemaFieldEntries,
    getSchemaFieldNames,
    isAppContent,
    normalizeLangCode,
    normalizeSorts,
    resolveFieldRef,
    resolveViewFilters,
    resolveViewSorts,
    setMetaValue,
} from './schemaUtils';

const schema = {
    Title: 'title',
    Status: 'select',
    Status_config: { id: 'fld_status', options: ['Open', 'Done'] },
    Idioma: 'select',
    Idioma_config: { id: 'fld_language' },
};

describe('schema field helpers', () => {
    it('reads field names, types, configs, and stable references', () => {
        expect(getSchemaFieldNames(schema)).toEqual(['Title', 'Status', 'Idioma']);
        expect(getSchemaFieldEntries(schema)).toEqual([
            ['Title', 'title'],
            ['Status', 'select'],
            ['Idioma', 'select'],
        ]);
        expect(getFieldType(schema, 'Missing')).toBe('text');
        expect(getFieldConfig(schema, 'Status')).toEqual({
            id: 'fld_status',
            options: ['Open', 'Done'],
        });
        expect(getFieldId(schema, 'Status')).toBe('fld_status');
        expect(getFieldNameById(schema, 'fld_status')).toBe('Status');
        expect(resolveFieldRef(schema, 'fld_status')).toEqual({
            id: 'fld_status',
            name: 'Status',
        });
    });

    it('reads legacy metadata and writes canonical field names', () => {
        const page = { metadata: { fld_status: 'Open' } };
        expect(getMetaValue(page, schema, 'Status')).toBe('Open');

        const metadata = { fld_status: 'Open' };
        expect(setMetaValue(metadata, schema, 'Status', 'Done')).toEqual({ Status: 'Done' });
        expect(metadata).toEqual({ Status: 'Done' });
    });
});

describe('schema conversion', () => {
    it('round-trips supported table property configuration', () => {
        const properties = [{
            id: 'fld_status',
            name: 'Status',
            type: 'status',
            options: ['Open', 'Done'],
            translatable: true,
            duration_enabled: false,
            period_unit: 'days',
            format: { kind: 'number', decimals: 2 },
        }];

        const built = buildSchemaFromTableProperties(properties);
        expect(built).toEqual({
            Status: 'status',
            Status_config: {
                id: 'fld_status',
                options: ['Open', 'Done'],
                translatable: true,
                duration_enabled: false,
                period_unit: 'days',
                format: { kind: 'number', decimals: 2 },
            },
        });
        expect(buildTablePropertiesFromSchema(built)).toEqual([properties[0]]);
    });

    it('prefers fresh nested options over stale top-level options', () => {
        const built = buildSchemaFromTableProperties([{
            name: 'Status',
            type: 'select',
            options: ['Old'],
            config: { options: ['Fresh'] },
        }]);
        expect(getFieldConfig(built, 'Status').options).toEqual(['Fresh']);
    });
});

describe('language helpers', () => {
    it('normalizes language labels and locale variants', () => {
        expect(normalizeLangCode('Català')).toBe('ca');
        expect(normalizeLangCode('EN-GB')).toBe('en');
        expect(normalizeLangCode('xx')).toBe('xx');
        expect(normalizeLangCode('unknown')).toBe('');
    });

    it('detects a language stored by stable id', () => {
        expect(getLanguageFieldName(schema)).toBe('Idioma');
        expect(detectRecordSourceLang({ fld_language: ['Castellà'] }, schema)).toBe('es');
    });
});

describe('view normalization', () => {
    it('normalizes singular and plural sorts', () => {
        expect(normalizeSorts({ field: 'Title', direction: 'desc' })).toEqual([{
            id: 'sort-0',
            field: 'Title',
            direction: 'desc',
        }]);
        expect(resolveViewSorts({
            sort: { field: 'Title' },
            sorts: [{ id: 'primary', field: 'Status', direction: 'asc' }],
        })).toEqual([{ id: 'primary', field: 'Status', direction: 'asc' }]);
        expect(resolveViewSorts({ sorts: [] }, { field: 'Title' })).toEqual([]);
    });

    it('unwraps historical filter containers', () => {
        const condition = { field: 'Status', operator: 'equals', value: 'Open' };
        expect(resolveViewFilters({ filters: { conditions: [condition, null] } }))
            .toEqual([condition]);
    });
});

describe('record classification', () => {
    it('classifies app folders and discovers only user metadata', () => {
        expect(isAppContent({ folder: 'Mail/Inbox' })).toBe(true);
        expect(isAppContent({ folder: 'Projects' })).toBe(false);
        expect(discoverFieldNamesFromRecords([
            { metadata: { title: 'One', Status: 'Open', favorite_color: 'red' } },
            { metadata: { status: 'Done', Owner: 'Ismael', cover_manual: true } },
        ])).toEqual(['Owner', 'Status']);
    });
});
