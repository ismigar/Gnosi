import type { IconName } from 'lucide-react/dynamic';
import { describe, expect, it } from 'vitest';

import {
    calculatePickerPosition,
    createLucideIconOptions,
    filterLucideIcons,
    MAX_CUSTOM_ICONS,
    normalizeCustomIcons,
    selectedLucideValue,
} from './model';


describe('IconPicker model', () => {
    it('normalizes, deduplicates, and caps custom icons', () => {
        const source = Array.from(
            { length: MAX_CUSTOM_ICONS + 4 },
            (_value, index) => ` https://icons.test/${String(index)}.png `,
        );
        source.splice(2, 0, source[0] ?? '', '', '   ');

        const normalized = normalizeCustomIcons([...source, null, 4]);

        expect(normalized).toHaveLength(MAX_CUSTOM_ICONS);
        expect(normalized.at(0)).toBe('https://icons.test/0.png');
        expect(new Set(normalized).size).toBe(MAX_CUSTOM_ICONS);
    });

    it('keeps Lucide display names searchable and selection payloads stable', () => {
        const names = ['file-text', 'book-open', 'camera'] satisfies IconName[];
        const options = createLucideIconOptions(names);

        expect(options.map(({ displayName }) => displayName)).toEqual([
            'BookOpen',
            'Camera',
            'FileText',
        ]);
        const filtered = filterLucideIcons(options, 'book');
        expect(filtered).toHaveLength(1);
        const book = filtered.at(0);
        if (!book) throw new Error('Missing filtered icon');
        expect(selectedLucideValue(book, 'purple')).toBe(
            'lucide:BookOpen:purple',
        );
    });

    it('preserves default, anchored, clamped, and flipped positions', () => {
        expect(calculatePickerPosition(null, { height: 900, width: 1200 }))
            .toEqual({ left: 48, top: 0 });
        expect(calculatePickerPosition(
            { bottom: 108, left: 100, top: 80 },
            { height: 900, width: 1200 },
        )).toEqual({ left: 100, top: 116 });
        expect(calculatePickerPosition(
            { bottom: 790, left: 1190, top: 760 },
            { height: 800, width: 1200 },
        )).toEqual({ left: 838, top: 252 });
    });
});
