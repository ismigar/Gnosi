import { afterEach, describe, expect, it, vi } from 'vitest';

import { importVaultMarkdown } from './markdown-import';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('Markdown import API', () => {
  it('imports browser-selected files through the generated contract', async () => {
    const imported = { errors: [], folder: 'Importades', imported: 2 };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(imported)),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(importVaultMarkdown({
      files: [
        { content: '# One', name: 'one.md' },
        { content: '# Two', name: 'two.md' },
      ],
      folder: 'Importades',
    })).resolves.toEqual(imported);

    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a Request');
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/vault/import');
    await expect(request.json()).resolves.toEqual({
      files: [
        { content: '# One', name: 'one.md' },
        { content: '# Two', name: 'two.md' },
      ],
      folder: 'Importades',
    });
  });
});
