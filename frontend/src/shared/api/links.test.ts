import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchLinkPreview } from './links';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('links API', () => {
  it('loads an encoded external-link preview', async () => {
    const preview = {
      description: 'Stable metadata',
      favicon: 'https://example.test/favicon.ico',
      image: 'https://example.test/cover.jpg',
      site_name: 'Example',
      title: 'Typed preview',
      url: 'https://example.test/article?a=1&b=2',
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(preview),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLinkPreview(preview.url)).resolves.toEqual(preview);

    const [input] = fetchMock.mock.calls[0] || [];
    if (!(input instanceof Request)) throw new Error('Expected a Request');
    expect(new URL(input.url).searchParams.get('url')).toBe(preview.url);
  });
});
