import { describe, expect, it } from 'vitest';
import { currentPageFilterDefaults } from './currentPageFilterDefaults';

const project = { field: 'Projecte', operator: 'equals', value: 'this' };

describe('creation defaults from current-page filters', () => {
    it('resolves the containing page ID and leaves the saved filter unchanged', () => {
        expect(currentPageFilterDefaults(project, 'project-id')).toEqual({ Projecte: 'project-id' });
        expect(project.value).toBe('this');
        expect(currentPageFilterDefaults(project, 'another-project')).toEqual({ Projecte: 'another-project' });
    });

    it('never writes the placeholder without a containing page', () => {
        expect(currentPageFilterDefaults(project, null)).toEqual({});
        expect(currentPageFilterDefaults(project, '')).toEqual({});
        expect(currentPageFilterDefaults(undefined, 'page')).toEqual({});
    });

    it.each(['not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty'])(
        'does not infer a value from %s', operator => {
            expect(currentPageFilterDefaults({ ...project, operator }, 'page')).toEqual({});
        },
    );

    it('collects nested AND equalities without guessing ordinary filter values', () => {
        expect(currentPageFilterDefaults({ rules: [project, { conjunction: 'AND', rules: [
            { field: 'Responsable', operator: 'equals', value: 'this' },
            { field: 'Estat', operator: 'equals', value: 'Pending' },
        ] }] }, 'page')).toEqual({ Projecte: 'page', Responsable: 'page' });
    });

    it('does not assign a project from an optional OR branch', () => {
        expect(currentPageFilterDefaults({ conjunction: 'or', rules: [
            project, { field: 'Estat', operator: 'equals', value: 'Pending' },
        ] }, 'page')).toEqual({});
        expect(currentPageFilterDefaults({ conjunction: 'or', rules: [] }, 'page')).toEqual({});
    });

    it('keeps a current-page equality shared by every OR branch', () => {
        expect(currentPageFilterDefaults({ conjunction: 'OR', rules: [
            { rules: [project, { field: 'Estat', operator: 'equals', value: 'Pending' }] },
            { rules: [project, { field: 'Responsable', operator: 'equals', value: 'this' }] },
        ] }, 'page')).toEqual({ Projecte: 'page' });
    });

    it.each(['title', 'id', 'table_id', 'database_table_id', 'database_id', 'is_template'])(
        'preserves the record %s instead of copying the containing page', field => {
            expect(currentPageFilterDefaults({ ...project, field }, 'page')).toEqual({});
        },
    );
});
