import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchExternalContextSources,
  fetchInternalContextSources,
} from './agent-context';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('agent context catalogues', () => {
  it('loads external and scoped internal source descriptors', async () => {
    const external = [{ description: 'Official law', id: 'boe', label: 'BOE' }];
    const internal = [{
      description: 'Saved articles',
      id: 'reader',
      name: 'Reader',
      options: {},
      scope: {},
    }];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(external))
      .mockResolvedValueOnce(Response.json(internal));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchExternalContextSources()).resolves.toEqual(external);
    await expect(fetchInternalContextSources()).resolves.toEqual(internal);

    const paths = fetchMock.mock.calls.map(([input]) =>
      new URL(input instanceof Request ? input.url : String(input), window.location.origin)
        .pathname,
    );
    expect(paths).toEqual([
      '/api/agent/context-sources',
      '/api/agent/internal-sources',
    ]);
  });
});
