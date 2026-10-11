import { expect, it } from 'vitest';
import { resolveSubitemsEnabled } from './subitems';

const main = { id: 'main', table_id: 'tasks', is_main: true, enableSubitems: true };
it('inherits the table setting when an embedded view has no subitem override', () => {
    expect(resolveSubitemsEnabled({ id: 'project', table_id: 'tasks' }, [main])).toBe(true);
    expect(resolveSubitemsEnabled({ id: 'project', source_table_id: 'tasks' }, [main])).toBe(true);
});
it('preserves explicit disabled and legacy view settings', () => {
    expect(resolveSubitemsEnabled({ table_id: 'tasks', enableSubitems: false }, [main])).toBe(false);
    expect(resolveSubitemsEnabled({ table_id: 'tasks', enable_subitems: false }, [main])).toBe(false);
    expect(resolveSubitemsEnabled({ table_id: 'tasks', enable_subitems: true }, [])).toBe(true);
});
it('does not borrow subitem settings from a different table', () => {
    expect(resolveSubitemsEnabled({ table_id: 'other' }, [main])).toBe(false);
    expect(resolveSubitemsEnabled({}, [main])).toBe(false);
    expect(resolveSubitemsEnabled({ table_id: 'tasks' }, [{ ...main, enableSubitems: false }])).toBe(false);
});
