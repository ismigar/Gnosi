import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GnosiApiError } from './errors';
import {
  linkExistingVaultFile,
  registerLocalVaultFile,
  uploadVaultInsertFile,
} from './vault-content';


type EventHandler = (event: Event) => void;


class FakeEventTarget {
  private readonly listeners = new Map<string, EventHandler[]>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ): void {
    if (typeof listener !== 'function') return;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}


class FakeXMLHttpRequest extends FakeEventTarget {
  static instances: FakeXMLHttpRequest[] = [];

  readonly headers = new Map<string, string>();
  readonly upload = new FakeEventTarget();
  body: Document | XMLHttpRequestBodyInit | null = null;
  method = '';
  responseText = '';
  status = 0;
  statusText = '';
  timeout = -1;
  url = '';
  withCredentials = false;

  constructor() {
    super();
    FakeXMLHttpRequest.instances.push(this);
  }

  abort(): void {
    this.emit('abort', new Event('abort'));
  }

  getAllResponseHeaders(): string {
    return 'content-type: application/json\r\n';
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body: Document | XMLHttpRequestBodyInit | null = null): void {
    this.body = body;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  respond(status: number, payload: unknown, statusText = 'OK'): void {
    this.status = status;
    this.statusText = statusText;
    this.responseText = JSON.stringify(payload);
    this.emit('load', new Event('load'));
  }
}


afterEach(() => {
  FakeXMLHttpRequest.instances = [];
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


function latestXhr(): FakeXMLHttpRequest {
  const xhr = FakeXMLHttpRequest.instances.at(-1);
  if (!xhr) throw new Error('Expected an XMLHttpRequest instance');
  return xhr;
}


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


describe('Vault content API', () => {
  it('uploads property FormData with progress and an unbounded timeout', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    writeApiTestStorage('gnosi_active_vault', 'vault-1');
    writeApiTestStorage('gnosi_active_vault_slug', 'main');
    const progress = vi.fn();
    const file = new File(['pdf'], 'paper.pdf', { type: 'application/pdf' });

    const pending = uploadVaultInsertFile(file, {
      destFolder: '/Users/ismael/Documents',
      onProgress: progress,
      propertyName: 'Attachment',
      storageFolder: 'free',
      tableId: 'table/1',
      targetName: 'Author - Paper',
    });
    const xhr = latestXhr();

    expect(xhr.method).toBe('POST');
    expect(xhr.timeout).toBe(0);
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers.get('x-vault-id')).toBe('vault-1');
    expect(xhr.headers.get('x-workspace-id')).toBe('personal');
    const url = new URL(xhr.url, window.location.origin);
    expect(url.pathname).toBe(
      '/api/v1/vaults/main/knowledge/upload-property-file',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      property_name: 'Attachment',
      storage_folder: 'free',
      table_id: 'table/1',
      target_name: 'Author - Paper',
    });
    expect(xhr.body).toBeInstanceOf(FormData);
    const body = xhr.body as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('dest_folder')).toBe('/Users/ismael/Documents');

    xhr.upload.emit(
      'progress',
      new ProgressEvent('progress', {
        lengthComputable: true,
        loaded: 50,
        total: 100,
      }),
    );
    expect(progress).toHaveBeenCalledWith({ loaded: 50, total: 100 });

    xhr.respond(200, {
      path: '/Users/ismael/Documents/paper.pdf',
      storage: 'absolute',
      url: null,
    });
    await expect(pending).resolves.toMatchObject({
      path: '/Users/ismael/Documents/paper.pdf',
      url: null,
    });
  });


  it('keeps generic asset upload URL and supports AbortSignal', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    const controller = new AbortController();
    const file = new File(['image'], 'cover.png', { type: 'image/png' });

    const pending = uploadVaultInsertFile(file, {
      signal: controller.signal,
      tableId: 'table-1',
    });
    const xhr = latestXhr();
    expect(xhr.url).toBe('/api/vault/assets/upload?table_id=table-1');
    expect((xhr.body as FormData).get('dest_folder')).toBeNull();

    controller.abort(new Error('upload cancelled'));
    await expect(pending).rejects.toThrow('upload cancelled');
  });


  it('posts long-running local link/register requests through openapi-fetch', async () => {
    const linked = {
      path: '/Users/ismael/paper.pdf',
      storage: 'absolute',
      url: null,
    };
    const registered = {
      extension: '.pdf',
      kind: 'pdf',
      name: 'paper.pdf',
      path: '/Users/ismael/paper.pdf',
      size: 42,
      token: 'token-1',
      url: '/api/vault/local-file/token-1/paper.pdf',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(linked))
      .mockResolvedValueOnce(Response.json(registered));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      linkExistingVaultFile('/Users/ismael/paper.pdf', 'Renamed paper'),
    ).resolves.toEqual(linked);
    await expect(
      registerLocalVaultFile('/Users/ismael/paper.pdf'),
    ).resolves.toEqual(registered);

    const link = requestAt(fetchMock.mock.calls, 0);
    expect(link.method).toBe('POST');
    expect(new URL(link.url).pathname).toBe(
      '/api/vault/link-existing-file',
    );
    await expect(link.json()).resolves.toEqual({
      file_path: '/Users/ismael/paper.pdf',
      target_name: 'Renamed paper',
    });

    const register = requestAt(fetchMock.mock.calls, 1);
    expect(register.method).toBe('POST');
    expect(new URL(register.url).pathname).toBe(
      '/api/vault/local-file/register',
    );
    await expect(register.json()).resolves.toEqual({
      file_path: '/Users/ismael/paper.pdf',
    });
  });


  it('normalizes multipart API errors', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    const pending = uploadVaultInsertFile(
      new File(['bad'], 'bad.pdf', { type: 'application/pdf' }),
    );
    latestXhr().respond(422, { detail: 'Invalid file' }, 'Unprocessable Entity');

    await expect(pending).rejects.toMatchObject({
      message: 'Invalid file',
      name: 'GnosiApiError',
      status: 422,
    } satisfies Partial<GnosiApiError>);
  });
});
