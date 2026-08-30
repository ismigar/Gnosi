import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMeetingStatus } from './meetings';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('meetings API', () => {
  it('reads the typed processing status', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        error: null,
        page_id: null,
        progress: 42,
        running: true,
        stage: 'transcribing',
        title: 'Weekly sync',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMeetingStatus();

    expect(result.stage).toBe('transcribing');
    const [input, init] = fetchMock.mock.calls[0] || [];
    const request = input instanceof Request
      ? input
      : new Request(new URL(String(input), window.location.origin), init);
    expect(new URL(request.url).pathname).toBe('/api/meetings/status');
    expect(request.method).toBe('GET');
  });
});
