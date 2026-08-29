import { describe, expect, it } from 'vitest';

import {
    calculateCoverPickerPosition,
    PREDEFINED_COVER_GROUPS,
} from './model';


describe('cover picker model', () => {
    it('keeps the legacy fallback and anchored popover positions', () => {
        expect(calculateCoverPickerPosition(null, 1200)).toEqual({
            right: 20,
            top: 60,
        });
        expect(calculateCoverPickerPosition({ bottom: 90, right: 1040 }, 1200))
            .toEqual({ right: 160, top: 98 });
    });

    it('keeps the complete predefined catalogue and translation mapping', () => {
        expect(PREDEFINED_COVER_GROUPS.map((group) => ({
            count: group.images.length,
            labelKey: group.labelKey,
            name: group.name,
        }))).toEqual([
            {
                count: 6,
                labelKey: 'cover_picker.groups.colors',
                name: 'Colors i Degradats',
            },
            {
                count: 6,
                labelKey: 'cover_picker.groups.nature',
                name: 'Espai i Natura',
            },
            {
                count: 6,
                labelKey: 'cover_picker.groups.architecture',
                name: 'Arquitectura i Textures',
            },
        ]);
        expect(new Set(PREDEFINED_COVER_GROUPS.flatMap((group) => group.images)).size)
            .toBe(18);
    });
});
