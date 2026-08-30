import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadVaultAsset } from './vault-specialized';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('specialized vault transports', () => {
  it('uploads multipart assets with encoded table and target naming', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        is_image: true,
        path: 'Assets/Inline/figure.png',
        url: '/api/vault/assets/Inline/figure.png',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadVaultAsset(
      new File(['image'], 'figure.png', { type: 'image/png' }),
      { tableId: 'research notes', targetName: 'Figure 2' },
    );

    expect(result.url).toBe('/api/vault/assets/Inline/figure.png');
    const [input, init] = fetchMock.mock.calls[0] || [];
    const request = input instanceof Request
      ? input
      : new Request(new URL(String(input), window.location.origin), init);
    const url = new URL(request.url);
    expect(url.searchParams.get('table_id')).toBe('research notes');
    expect(url.searchParams.get('target_name')).toBe('Figure 2');
    expect(request.method).toBe('POST');
  });
});
