import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDefaultFormulasToMetadata } from './defaultFormulaUtils';

afterEach(() => { vi.useRealTimers(); });

describe('default formulas preserve document metadata', () => {
    it('preserves relation arrays and opaque plugin values by identity', () => {
        const relations = [{ id: 'linked', title: 'Linked' }];
        const extension = { nested: { keep: ['value'] } };
        const metadata = { relations, extension, existing: false };
        const result = applyDefaultFormulasToMetadata({ metadata, schema: { label: 'text', label_config: { defaultFormula: '{title}' } }, title: 'New note', currentTableId: null });
        expect(result).toEqual({ ...metadata, label: 'New note' });
        expect(result.relations).toBe(relations); expect(result.extension).toBe(extension);
        expect(metadata).not.toHaveProperty('label');
    });
    it('only fills missing, null and empty values, leaving zero and false intact', () => {
        const entries: [string, unknown][] = ['missing', 'empty', 'nil', 'zero', 'flag']
            .flatMap<[string, unknown]>(key => [[key, 'text'], [`${key}_config`, { defaultFormula: 'default' }]]);
        const schema: Record<string, unknown> = Object.fromEntries(entries);
        expect(applyDefaultFormulasToMetadata({ schema, metadata: { empty: '', nil: null, zero: 0, flag: false } }))
            .toEqual({ missing: 'default', empty: 'default', nil: 'default', zero: 0, flag: false });
    });
    it('retains legacy property string coercion for arrays and objects without altering the source', () => {
        const metadata = { tags: ['a', 'b'], opaque: { keep: true } };
        const schema = { a: 'text', a_config: { defaultFormula: '{tags}' }, b: 'text', b_config: { defaultFormula: '{opaque}' } };
        expect(applyDefaultFormulasToMetadata({ schema, metadata })).toEqual({ ...metadata, a: 'a,b', b: '[object Object]' });
    });
    it('uses local calendar dates for today and now and retains literal default expressions', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 30, 14));
        const schema = { day: 'date', day_config: { defaultFormula: 'today()' }, time: 'date', time_config: { defaultFormula: 'now()' }, literal: 'text', literal_config: { defaultFormula: '  Hello  ' } };
        expect(applyDefaultFormulasToMetadata({ schema })).toEqual({ day: '2026-08-30', time: '2026-08-30', literal: 'Hello' });
    });
});
