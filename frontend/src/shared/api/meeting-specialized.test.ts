import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadMeetingRecording } from './meeting-specialized';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('specialized meeting transport', () => {
  it('uploads the recording through the reviewed multipart boundary', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ status: 'started' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadMeetingRecording(
      new Blob(['audio'], { type: 'audio/webm' }),
      'Weekly sync',
      'online',
    );

    expect(result.status).toBe('started');
    const [input, init] = fetchMock.mock.calls[0] || [];
    expect(input).toBe('/api/meetings/record');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    const body = init?.body as FormData;
    expect(body.get('title')).toBe('Weekly sync');
    expect(body.get('mode')).toBe('online');
    expect(body.get('audio')).toBeInstanceOf(Blob);
  });
});
