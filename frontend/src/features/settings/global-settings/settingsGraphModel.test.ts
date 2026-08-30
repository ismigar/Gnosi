import { describe, expect, it } from 'vitest';
import type { VaultGraphNode } from '../../../shared/api/graph';
import { settingsGraphNode } from './settingsGraphModel';
const base: VaultGraphNode = { id: 'node', key: 'node', cluster: null, color: 'blue', database_id: null, table_id: null, kind: 'Wiki', label: 'Node', metadata: {}, path: '', size: 1 };

describe('settings graph projection', () => {
    it('keeps nested field values untouched and recognizes a scalar table id', () => {
        const metadata = { number: 12, status: ['Pending', 'Done'], extension: { keep: true } };
        const node = { ...base, kind: 'page', database_id: 'db', table_id: 17, metadata };
        const result = settingsGraphNode(node);
        expect(result.tableId).toBe('17'); expect(result.metadata).toEqual(metadata);
        expect(result.metadata.extension).toBe(metadata.extension);
        expect(node.table_id).toBe(17);
    });
    it.each([
        { kind: 'calendar', metadata: { calendar_id: 'work' }, expected: 'calendar:work' },
        { kind: 'contact', metadata: { account_id: 'people' }, expected: 'contact:people' },
        { kind: 'mail', metadata: { account_id: 'inbox' }, expected: 'mail:inbox' },
        { kind: 'Wiki', metadata: {}, expected: 'wiki' },
    ])('preserves $kind system categories', ({ kind, metadata, expected }) => {
        expect(settingsGraphNode({ ...base, kind, metadata }).tableId).toBe(expected);
    });
    it('rejects non-transport values rather than silently dropping field options', () => {
        expect(() => settingsGraphNode({ ...base, metadata: { invalid: () => 'not JSON' } })).toThrow('Invalid graph transport attribute');
    });
});
