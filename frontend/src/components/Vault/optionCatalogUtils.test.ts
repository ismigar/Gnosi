import { describe, expect, it } from 'vitest';

import {
    DEFAULT_STATUS_GROUPS,
    OPTION_COLOR_PALETTE,
    STATUS_DRAFT,
    checkActionRequires,
    findRoleFieldName,
    normalizeOption,
    normalizeOptions,
    optionChipStyle,
    seedOptionsForFeature,
} from './optionCatalogUtils';

describe('optionCatalogUtils', () => {
    it('normalizes legacy and rich options without duplicate names', () => {
        const options = normalizeOptions([
            'Draft',
            { name: 'Published', color: 'green', group: 'Final' },
            { name: 'Draft', color: 'red' },
            { name: '', color: 'blue' },
        ]);

        expect(options).toHaveLength(2);
        expect(options[0]?.name).toBe('Draft');
        expect(options[1]).toEqual({
            name: 'Published',
            color: 'green',
            group: 'Final',
        });
        expect(OPTION_COLOR_PALETTE).toContain(options[0]?.color);
        expect(normalizeOption(null)).toBeNull();
    });

    it('returns theme-safe chip styles only for palette colors', () => {
        expect(optionChipStyle('blue')).toEqual({
            backgroundColor: '#3b82f626',
            borderColor: '#3b82f659',
            color: '#3b82f6',
        });
        expect(optionChipStyle('javascript:alert(1)')).toBeNull();
    });

    it('finds semantic fields by explicit role before the legacy name heuristic', () => {
        expect(findRoleFieldName({
            Workflow: 'text',
            Workflow_config: { role: 'status' },
            Estat: 'status',
        }, 'status')).toBe('Workflow');
        expect(findRoleFieldName({ Etiquetes: 'multi_select' }, 'tags')).toBe('Etiquetes');
    });

    it('evaluates default and group-based action requirements', () => {
        const schema = {
            Estat: 'status',
            Estat_config: {
                id: 'status-id',
                options: [
                    { name: STATUS_DRAFT, color: 'gray', group: 'Inicial' },
                    { name: 'Publicat', color: 'green', group: 'Final' },
                ],
            },
        };

        expect(checkActionRequires(
            schema,
            { 'status-id': STATUS_DRAFT },
            'translate_row',
        )).toEqual({
            ok: false,
            reason: 'No es pot traduir si està en esborrany',
        });
        expect(checkActionRequires(
            schema,
            { 'status-id': 'Publicat' },
            'publish',
            {
                publish: {
                    requires: [{
                        role: 'status',
                        in_group: 'Final',
                        reason: 'Cal un estat final',
                    }],
                },
            },
        )).toEqual({ ok: true, reason: null });
    });

    it('returns the documented feature seed groups', () => {
        const seeded = seedOptionsForFeature('base');
        expect(seeded.map(({ group }) => group)).toEqual(['Inicial', 'En curs']);
        expect(DEFAULT_STATUS_GROUPS).toEqual(['Inicial', 'En curs', 'Final']);
        expect(seedOptionsForFeature('unknown')).toEqual([]);
    });
});
