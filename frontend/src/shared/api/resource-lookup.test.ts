import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GnosiApiError } from './errors';
import {
  lookupMetadata,
  promoteZoteroExtra,
  recognizePdf,
  translateUrl,
} from './resource-lookup';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


function requestAt(
  calls: [RequestInfo | URL, RequestInit?][],
  index: number,
): Request {
  const call = calls[index];
  if (!call) throw new Error(`Expected fetch call ${String(index)}`);
  const [input, init] = call;
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
}


const lookupResponse = {
  error: null,
  identifier: '10.1000/example',
  source: 'crossref' as const,
  suggested: { DOI: '10.1000/example', Title: 'Example' },
};


describe('resource lookup API', () => {
  it('posts lookup and URL translation as exact JSON requests', async () => {
    const translated = {
      count: 1,
      error: null,
      identifier: 'https://example.test/paper',
      source: 'web' as const,
      suggested: { Title: 'Web paper' },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(lookupResponse))
      .mockResolvedValueOnce(Response.json(translated));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      lookupMetadata({ doi: '10.1000/example', url: undefined }),
    ).resolves.toEqual(lookupResponse);
    await expect(
      translateUrl({ url: 'https://example.test/paper' }),
    ).resolves.toEqual(translated);

    const lookupRequest = requestAt(fetchMock.mock.calls, 0);
    expect(lookupRequest.method).toBe('POST');
    expect(new URL(lookupRequest.url).pathname).toBe(
      '/api/vault/lookup-metadata',
    );
    expect(lookupRequest.headers.get('content-type')).toContain(
      'application/json',
    );
    await expect(lookupRequest.json()).resolves.toEqual({
      doi: '10.1000/example',
    });

    const translationRequest = requestAt(fetchMock.mock.calls, 1);
    expect(translationRequest.method).toBe('POST');
    expect(new URL(translationRequest.url).pathname).toBe(
      '/api/vault/translate-url',
    );
    await expect(translationRequest.json()).resolves.toEqual({
      url: 'https://example.test/paper',
    });
  });


  it('posts the generated Zotero promotion payload as JSON', async () => {
    const promoted = {
      column_created: true,
      column_id: 'column-1',
      column_name: 'Patent number',
      conflicts: [],
      errors: [],
      migrated: 2,
      migrated_ids: ['page-1', 'page-2'],
      migrated_with_etags: [],
      skipped: [],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(promoted),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      promoteZoteroExtra({
        column_name: 'Patent number',
        column_type: 'text',
        table_id: 'resources',
        zotero_field: 'patentNumber',
      }),
    ).resolves.toEqual(promoted);

    const request = requestAt(fetchMock.mock.calls, 0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe(
      '/api/vault/promote-zotero-extra',
    );
    await expect(request.json()).resolves.toEqual({
      column_name: 'Patent number',
      column_type: 'text',
      table_id: 'resources',
      zotero_field: 'patentNumber',
    });
  });


  it('uploads a PDF through the specialized multipart transport', async () => {
    const recognized = {
      error: null,
      identifiers: { doi: '10.1000/example' },
      source: 'pdf' as const,
      suggested: { Title: 'Recognized paper' },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(recognized),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['pdf'], 'paper.pdf', { type: 'application/pdf' });

    await expect(recognizePdf(file)).resolves.toEqual(recognized);

    const [input, init] = fetchMock.mock.calls[0] || [];
    expect(input).toBe('/api/vault/recognize-pdf');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).has('content-type')).toBe(false);
    const body = init?.body as FormData;
    expect(body.get('file')).toBe(file);
  });


  it('normalizes JSON and multipart API failures as GnosiApiError', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { detail: 'Lookup unavailable' },
          { status: 503, statusText: 'Service Unavailable' },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { detail: 'Invalid PDF' },
          { status: 422, statusText: 'Unprocessable Entity' },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookupMetadata({ doi: '10.1000/error' })).rejects.toMatchObject({
      message: 'Lookup unavailable',
      name: 'GnosiApiError',
      status: 503,
    } satisfies Partial<GnosiApiError>);
    await expect(
      recognizePdf(new File(['bad'], 'bad.pdf', { type: 'application/pdf' })),
    ).rejects.toMatchObject({
      message: 'Invalid PDF',
      name: 'GnosiApiError',
      status: 422,
    } satisfies Partial<GnosiApiError>);
  });
});
