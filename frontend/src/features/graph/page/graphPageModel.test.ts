import { describe, expect, it } from 'vitest';

import type { ConfigurationDocument } from '../../../shared/api/configuration';
import type { VaultGraphData, VaultGraphNode } from '../../../shared/api/graph';
import {
  buildFilterGraph,
  deriveFieldValues,
  deriveFolderNames,
  deriveGraphSources,
  deriveIdLabels,
  deriveMediaTags,
  deriveTimelineRange,
  displayGraphFieldValue,
  findShortestPath,
  graphSettingsFromDocument,
  seedGraphConfigurationDocument,
} from './graphPageModel';


function node(
  key: string,
  overrides: Partial<VaultGraphNode> = {},
): VaultGraphNode {
  return {
    cluster: null,
    color: '#334155',
    database_id: null,
    id: key,
    key,
    kind: 'Wiki',
    label: key,
    metadata: {},
    path: `${key}.md`,
    size: 8,
    table_id: null,
    ...overrides,
  };
}


function graphData(
  nodes: VaultGraphNode[],
  edges: VaultGraphData['edges'] = [],
): VaultGraphData {
  return {
    edges,
    legend: { clusters: [], kinds: [] },
    nodes,
  };
}


describe('graph page model', () => {
  it('counts multiple fields from their own tables, preserving value precedence, duplicates and ties', () => {
    const data = graphData([
      node('a', {
        kind: 'record', table_id: 'table-a', Status: 'Active',
        metadata: { status: 'Ignored by top-level value', tags: ['Alpha', 'Alpha', 'Beta'], Zero: 0, Flag: false },
      }),
      node('b', { kind: 'record', table_id: 'table-a', metadata: { STATUS: 'Active', tags: ['Beta', null, ''] } }),
      node('c', { kind: 'record', table_id: 'table-b', metadata: { Status: 'Done' } }),
      node('wiki', { metadata: { Status: 'Wiki' } }),
      node('event', { kind: 'calendar', table_id: 'table-a', metadata: { calendar_id: 'calendar-a', Status: 'Event' } }),
    ]);
    const original = structuredClone(data);
    const graph = buildFilterGraph(data);
    const fields = ['invalid', 'table-a:Status', 'table-a:Tags', 'table-a:Zero', 'table-a:Flag',
      'table-b:Status', 'wiki:Status', 'table-a:Missing', 'table-a:Tags'];
    expect(deriveFieldValues(graph, fields)).toEqual({
      'table-a:Status': [['Active', 2]],
      'table-a:Tags': [['Alpha', 2], ['Beta', 2]],
      'table-a:Zero': [['0', 1]],
      'table-a:Flag': [['false', 1]],
      'table-b:Status': [['Done', 1]],
      'wiki:Status': [['Wiki', 1]],
      'table-a:Missing': [],
    });
    expect(data).toEqual(original);
    expect(deriveFieldValues(graph, [])).toEqual({});
    expect(deriveFieldValues(null, ['table-a:Status'])).toEqual({ 'table-a:Status': [] });
  });

  it('updates counts after graph data or the configured fields change', () => {
    const graph = buildFilterGraph(graphData([node('a', { metadata: { Status: 'Before', Tags: ['one'] } })]));
    expect(deriveFieldValues(graph, ['wiki:Status'])).toEqual({ 'wiki:Status': [['Before', 1]] });
    graph?.setNodeAttribute('a', 'metadata', { Status: 'After', Tags: ['two', 'three'] });
    expect(deriveFieldValues(graph, ['wiki:Status', 'wiki:Tags'])).toEqual({
      'wiki:Status': [['After', 1]], 'wiki:Tags': [['two', 1], ['three', 1]],
    });
  });
  it('normalizes graph settings and preserves seeded source configuration', () => {
    const document: ConfigurationDocument = {
      graph: {
        field_defaults: { 'wiki:Status': 'Done' },
        physics: { gravity: '0.4', lin_log_mode: true },
        sources_initialized: false,
        visible_databases: ['wiki'],
        visible_fields: ['wiki:Status'],
      },
      locale: 'ca',
    };

    expect(graphSettingsFromDocument(document)).toMatchObject({
      field_defaults: { 'wiki:Status': 'Done' },
      physics: { gravity: 0.4, lin_log_mode: true },
      visible_databases: ['wiki'],
      visible_fields: ['wiki:Status'],
    });
    expect(seedGraphConfigurationDocument(document, {
      databases: ['wiki', 'images'],
      tables: ['table-a'],
    })).toMatchObject({
      graph: {
        sources_initialized: true,
        visible_databases: ['wiki', 'images'],
        visible_tables: ['table-a'],
      },
      locale: 'ca',
    });
  });

  it('derives configured field values, labels, folders, tags, and dates', () => {
    const data = graphData([
      node('page-a', {
        created_time: '2026-08-01T00:00:00Z',
        label: 'Alpha',
        metadata: { Status: 'Done', tags: ['portrait', 'travel'] },
      }),
      node('media-b', {
        created_time: '2026-08-30T00:00:00Z',
        kind: 'media',
        label: 'Image',
        metadata: {
          database_table_id: 'inline-table',
          tags: ['travel'],
        },
        path: 'BD/Cervell Digital/Titulacions/media-b.md',
        table_id: 'inline-table',
      }),
    ]);

    expect(deriveFieldValues(buildFilterGraph(data), ['wiki:Status'])).toEqual({
      'wiki:Status': [['Done', 1]],
    });
    expect(deriveIdLabels(data, { external: 'External page' })).toMatchObject({
      external: 'External page',
      'page-a': 'Alpha',
    });
    expect(deriveIdLabels(data, { 'page-a': 'Canonical indexed title' })['page-a'])
      .toBe('Canonical indexed title');
    expect(deriveFolderNames(data).get('inline-table')).toBe('Titulacions');
    expect(deriveMediaTags(data)).toEqual(['travel']);
    expect(deriveTimelineRange(data)).toEqual([
      Date.parse('2026-08-01T00:00:00Z'),
      Date.parse('2026-08-30T00:00:00Z'),
    ]);
    expect(displayGraphFieldValue('external', { external: 'External page' }))
      .toBe('External page');
    expect(displayGraphFieldValue('123e4567-e89b-12d3-a456-426614174000', {}))
      .toBe('123e4567…');
  });

  it('classifies sources and finds the shortest structural path', () => {
    const data = graphData(
      [
        node('a'),
        node('b'),
        node('c', {
          database_id: 'database-a',
          kind: 'record',
          table_id: 'table-a',
        }),
      ],
      [
        {
          body_link: true,
          color: '#000',
          dashed: false,
          directed: true,
          dst: 'b',
          id: 'a-b',
          kind: 'link',
          size: 1,
          source: 'a',
          src: 'a',
          target: 'b',
          unresolved: false,
        },
        {
          body_link: true,
          color: '#000',
          dashed: false,
          directed: true,
          dst: 'c',
          id: 'b-c',
          kind: 'link',
          size: 1,
          source: 'b',
          src: 'b',
          target: 'c',
          unresolved: false,
        },
      ],
    );

    expect(deriveGraphSources(data.nodes)).toEqual({
      databases: ['wiki', 'database-a'],
      tables: ['wiki', 'table-a'],
    });
    const path = findShortestPath(buildFilterGraph(data), 'a', 'c');
    expect(path?.fullPath).toEqual(['a', 'b', 'c']);
    expect([...path?.edges ?? []]).toHaveLength(2);
  });

  it('returns an explicit no-path result for disconnected nodes', () => {
    const graph = buildFilterGraph(graphData([node('a'), node('b')]));
    expect(findShortestPath(graph, 'a', 'b')).toMatchObject({
      fullPath: [],
      noPath: true,
    });
  });
});
