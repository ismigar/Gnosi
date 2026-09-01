import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  exportReferences,
  fetchCslStyles,
  importReferences,
  uploadCslStyle,
} from './citation-io';
import { GnosiApiError } from './errors';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


function requestAt(calls: [RequestInfo | URL, RequestInit?][], index: number): Request {
  const call = calls[index];
  if (!call) throw new Error(`Expected fetch call ${String(index)}`);
  const [input, init] = call;
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
}


const imported = {
  created: 1,
  errors: [],
  format: 'bibtex',
  items: [{ citation_key: 'ada2026', id: 'page-1', title: 'Research' }],
  skip_summary: { citation_key: 0, doi: 0, isbn: 0, title: 0 },
  skipped: 0,
  skipped_details: [],
  skipped_keys: [],
};


describe('Citation I/O API', () => {
  it('lists CSL styles through the generated JSON client', async () => {
    const styles = [
      { file: 'apa.csl', id: 'apa', title: 'APA 7th edition' },
    ];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ styles }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCslStyles()).resolves.toEqual(styles);

    const request = requestAt(fetchMock.mock.calls, 0);
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/api/vault/csl/styles');
  });

  it('posts import and CSL upload files as multipart and returns JSON', async () => {
    const uploaded = {
      file: 'custom-style.csl',
      id: 'custom-style',
      title: 'Custom Style',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(imported))
      .mockResolvedValueOnce(Response.json(uploaded));
    vi.stubGlobal('fetch', fetchMock);
    const references = new File(['@book{}'], 'library.bib', {
      type: 'application/x-bibtex',
    });
    const style = new File(['<style/>'], 'custom-style.csl', {
      type: 'application/xml',
    });

    await expect(
      importReferences(references, {
        format: 'auto',
        tableId: 'Research & Notes',
      }),
    ).resolves.toEqual(imported);
    await expect(uploadCslStyle(style)).resolves.toEqual(uploaded);

    const importRequest = requestAt(fetchMock.mock.calls, 0);
    const importUrl = new URL(importRequest.url);
    expect(importRequest.method).toBe('POST');
    expect(importUrl.searchParams.get('table_id')).toBe('Research & Notes');
    expect(importUrl.searchParams.get('fmt')).toBe('auto');
    const importBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(importBody).toBeInstanceOf(FormData);
    expect((importBody as FormData).get('file')).toBe(references);

    const uploadRequest = requestAt(fetchMock.mock.calls, 1);
    expect(uploadRequest.method).toBe('POST');
    expect(new URL(uploadRequest.url).pathname).toBe('/api/vault/csl/styles');
    const uploadBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(uploadBody).toBeInstanceOf(FormData);
    expect((uploadBody as FormData).get('file')).toBe(style);
  });

  it('downloads binary exports with encoded query parameters', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('@book{ada2026}', {
        headers: { 'Content-Type': 'application/x-bibtex' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const download = await exportReferences({
      format: 'bibtex',
      keys: 'ada2026,hopper 1952',
      tableId: 'Research & Notes',
    });

    await expect(download.text()).resolves.toBe('@book{ada2026}');
    const request = requestAt(fetchMock.mock.calls, 0);
    const url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(url.pathname).toBe('/api/vault/export-references');
    expect(url.searchParams.get('table_id')).toBe('Research & Notes');
    expect(url.searchParams.get('fmt')).toBe('bibtex');
    expect(url.searchParams.get('keys')).toBe('ada2026,hopper 1952');
  });

  it('surfaces FastAPI error details through GnosiApiError', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { detail: 'The CSL document is invalid' },
        { status: 422, statusText: 'Unprocessable Entity' },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = uploadCslStyle(new File(['bad'], 'bad.csl'));

    await expect(request).rejects.toBeInstanceOf(GnosiApiError);
    await expect(request).rejects.toMatchObject({
      message: 'The CSL document is invalid',
      status: 422,
    });
  });
});
