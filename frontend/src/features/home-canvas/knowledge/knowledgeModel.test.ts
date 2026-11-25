import { expect, it } from 'vitest';
import type { VaultPageSummary, VaultSidebarPageSummary } from '../../../shared/api/vaults';
import { readOnlyDashboardView } from '../../vault';
import { dashboardLayout } from './dashboardModel';
import { graphNeighbors, latestDatedNote } from './graphModel';

function row(id: string, title: string, metadata: Record<string, unknown> = {}): VaultPageSummary {
  return { id, title, metadata, is_database: false, folder: 'Wiki', last_modified: '', size: 1 };
}

it('selects Markdown headings and stable view bindings, including nested filters stored only in the registry', () => {
  const config = { section_id: 'persisted', heading: 'Tasks', source_table_id: 'tasks', view_id: 'open' };
  const md = ['# Sprint', 'A sprint board.', '```gnosi-view', '{"section_id":"persisted","heading":"Tasks","view_id":"open"}', '```', '# Later', 'Private notes'].join('\n');
  const board = dashboardLayout(md, [config]);
  const selected = board.choices.find(choice => choice.label === 'Tasks');
  expect(selected).toBeDefined();
  expect(board.partsFor(selected?.key ?? '')).toMatchObject([{ kind: 'view', view: config }]);
  expect(board.partsFor('heading:sprint')).toHaveLength(2);
  expect(JSON.stringify(board.partsFor('heading:sprint'))).not.toContain('Private notes');
  expect(board.partsFor('heading:removed')).toBeNull();
  const renamed = dashboardLayout(md.replace('Tasks', 'Renamed'), [config]);
  expect(renamed.partsFor(selected?.key ?? '')).toMatchObject([{ kind: 'view', label: 'Renamed' }]);
});

it('accepts empty, legacy registry-only and BlockNote JSON dashboard bodies', () => {
  expect(dashboardLayout('{\n \n}', []).partsFor('')).toEqual([]);
  expect(dashboardLayout('{}', [{ heading: 'Old', source_table_id: 'old' }]).partsFor('')).toMatchObject([{ kind: 'view', label: 'Old' }]);
  const blocks = [{ type: 'gnosi_view', props: { view_id: '', heading: 'Weekly', section: '{"source_table_id":"tasks"}' } }];
  expect(dashboardLayout(JSON.stringify(blocks), []).partsFor('')).toMatchObject([{ kind: 'view', label: 'Weekly', view: { source_table_id: 'tasks' } }]);
});

it('recognizes HTML comment view definitions and skips snapshot result tables', () => {
  const registered = [{ view_id: 'view-inbox', name: 'Inbox' }, { view_id: 'view-actions', name: 'Actions' }];
  const md = [
    ':::column-list',
    ':::column',
    '# Inbox',
    '<!-- gnosi-view:def {"view_id":"view-inbox"} -->',
    '',
    '<!-- gnosi-view:result view_id=view-inbox -->',
    '| Old | Snapshot | Table |',
    '| --- | --- | --- |',
    '| Task 1 | Open | 2026-11-24 |',
    '<!-- /gnosi-view:result -->',
    ':::',
    ':::column',
    '# Actions',
    '<!-- gnosi-view:def {"view_id":"view-actions"} -->',
    ':::',
    ':::',
  ].join('\n');
  const board = dashboardLayout(md, registered);
  const parts = board.partsFor('');
  expect(parts).toHaveLength(5);
  expect(parts?.[0]).toMatchObject({ kind: 'text', markdown: ':::column-list\n:::column\n# Inbox' });
  expect(parts?.[1]).toMatchObject({ kind: 'view', label: 'Inbox', view: { view_id: 'view-inbox' } });
  expect(parts?.[2]).toMatchObject({ kind: 'text', markdown: ':::\n:::column\n# Actions' });
  expect(parts?.[3]).toMatchObject({ kind: 'view', label: 'Actions', view: { view_id: 'view-actions' } });
  expect(parts?.[4]).toMatchObject({ kind: 'text', markdown: ':::\n:::' });
});

it('uses registered nested filters, the host board, joined values and numeric multi-sort before limiting visible records', async () => {
  const host = 'board-id';
  const makeTask = (index: number, metadata: Record<string, unknown> = {}) => row(`task-${String(index)}`, `Title ${String(index)}`,
    { Owner: 'person', Rank: index, Status: 'open', Boards: [host], ...metadata });
  const tasks = [makeTask(22, { is_template: true }), makeTask(21, { Boards: ['other'] }), makeTask(20, { Status: 'closed' }),
    ...[2, 10, 3, 1, 4, 14, 12].map(n => makeTask(n))];
  const result = await readOnlyDashboardView(host, { source_table_id: 'tasks', filters: [{ field: 'Status', operator: 'equals', value: 'closed' }] }, {
    filterTree: { conjunction: 'and', rules: [{ field: 'Boards', operator: 'equals', value: 'this' }, { conjunction: 'or', rules: [
      { field: 'Status', operator: 'equals', value: 'open' }, { field: 'Priority', operator: 'equals', value: 'urgent' },
    ] }] },
    joins: [{ tableId: 'people', leftField: 'Owner', rightField: 'id', type: 'inner' }],
    sorts: [{ field: 'Rank', direction: 'desc' }, { field: 'title', direction: 'asc' }],
    visibleProperties: ['title', { fieldKey: 'Team', tableId: 'people' }],
  }, id => Promise.resolve(id === 'tasks' ? tasks : [row('person', 'Ada', { Team: 'Design' })]));
  expect(result?.total).toBe(7);
  expect(result?.records.map(r => r.id)).toEqual(['task-14', 'task-12', 'task-10', 'task-4', 'task-3', 'task-2']);
  expect(result?.records[0]?.cells).toEqual(['Design']);
});

it('keeps only existing direct neighbors, ranks both directions by personal edits and returns at most five', () => {
  const records: VaultSidebarPageSummary[] = ['a','b','c','d','e','f','center'].map(id => row(id, id));
  const catalog = new Map(records.map(page => [page.id, page]));
  const incoming = ['a','b','e','f','center','deleted'];
  const outgoing = ['b','c','d','e','deleted'];
  const neighbors = graphNeighbors('center', incoming, outgoing, catalog, [{ id: 'f', at: 12 }, { id: 'b', at: 10 }]);
  expect(neighbors.map(note => note.id)).toEqual(['f','b','a','c','d']);
  expect(neighbors[1]).toMatchObject({ incoming: true, outgoing: true });
});

it('uses only valid vault modification timestamps for the unpersonalized fallback', () => {
  const a = { ...row('a', 'A'), last_modified: '2026-11-15T10:00:00Z' };
  const b = { ...row('b', 'B'), last_modified: '2026-11-20T10:00:00Z' };
  expect(latestDatedNote([b, row('unknown', 'Z'), a])).toBe('b');
  expect(latestDatedNote([row('undated', 'No date')])).toBe('');
});
