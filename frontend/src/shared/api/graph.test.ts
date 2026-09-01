import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchVaultGraph } from './graph';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('graph API', () => {
  it('preserves heterogeneous node and edge extensions', async () => {
    const payload = {
      edges: [{
        body_link: true,
        color: '#64748b',
        custom_weight: 0.8,
        dashed: false,
        directed: true,
        dst: 'page-2',
        id: 'page-1-page-2',
        kind: 'wikilink',
        size: 1,
        source: 'page-1',
        src: 'page-1',
        target: 'page-2',
        unresolved: false,
      }],
      legend: { clusters: [], kinds: [] },
      nodes: [{
        cluster: null,
        color: '#3b82f6',
        custom_plugin_field: 'kept',
        database_id: null,
        id: 'page-1',
        key: 'page-1',
        kind: 'page',
        label: 'Page 1',
        metadata: {},
        path: '/Page 1.md',
        size: 10,
        table_id: null,
      }],
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultGraph()).resolves.toEqual(payload);
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(new URL(request.url).pathname).toBe('/api/graph');
  });
});
