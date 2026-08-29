import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchCustomIcons,
  importVaultIconUrl,
  saveCustomIcons,
  searchUnsplashCovers,
  uploadVaultCover,
  uploadVaultIcon,
} from './vault-icons';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('Vault icon API', () => {
  it('loads, saves, and imports icons through typed JSON routes', async () => {
    const icon = {
      path: 'Assets/Icons/icon-abc.svg',
      thumbnail_path: null,
      thumbnail_url: null,
      url: '/api/vault/assets/Icons/icon-abc.svg',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ icons: [icon.url] }))
      .mockResolvedValueOnce(Response.json({ icons: [icon.url] }))
      .mockResolvedValueOnce(Response.json(icon));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCustomIcons()).resolves.toEqual({ icons: [icon.url] });
    await expect(saveCustomIcons([icon.url])).resolves.toEqual({
      icons: [icon.url],
    });
    await expect(importVaultIconUrl('https://example.test/icon.svg')).resolves.toEqual(
      icon,
    );

    const saveRequest = fetchMock.mock.calls[1]?.[0];
    if (!(saveRequest instanceof Request)) throw new Error('Expected a Request');
    expect(saveRequest.method).toBe('PUT');
    await expect(saveRequest.json()).resolves.toEqual({ icons: [icon.url] });

    const importRequest = fetchMock.mock.calls[2]?.[0];
    if (!(importRequest instanceof Request)) throw new Error('Expected a Request');
    expect(importRequest.method).toBe('POST');
    await expect(importRequest.json()).resolves.toEqual({
      url: 'https://example.test/icon.svg',
    });
  });

  it('uploads one icon as multipart data', async () => {
    const icon = {
      path: 'Assets/Icons/icon-abc.png',
      thumbnail_path: null,
      thumbnail_url: null,
      url: '/api/vault/assets/Icons/icon-abc.png',
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(icon));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['icon'], 'icon.png', { type: 'image/png' });

    await expect(uploadVaultIcon(file)).resolves.toEqual(icon);

    const [input, init] = fetchMock.mock.calls[0] || [];
    expect(input).toBe('/api/vault/upload-icon');
    expect(init?.method).toBe('POST');
    if (!(init?.body instanceof FormData)) {
      throw new Error('Expected multipart form data');
    }
    const uploaded = init.body.get('file');
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe('icon.png');
  });

  it('searches and uploads Vault covers', async () => {
    const search = {
      results: [
        {
          author: 'Ada',
          author_url: 'https://unsplash.test/ada',
          id: 'photo-1',
          thumb: 'https://img.test/thumb',
          url: 'https://img.test/full',
        },
      ],
      total_pages: 3,
    };
    const cover = {
      path: 'Assets/Covers/cover.jpg',
      url: '/api/vault/assets/Covers/cover.jpg',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(search))
      .mockResolvedValueOnce(Response.json(cover));
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchUnsplashCovers('knowledge', 2)).resolves.toEqual(search);
    await expect(
      uploadVaultCover(new File(['cover'], 'cover.jpg', { type: 'image/jpeg' })),
    ).resolves.toEqual(cover);

    const searchRequest = fetchMock.mock.calls[0]?.[0];
    if (!(searchRequest instanceof Request)) throw new Error('Expected a Request');
    const searchUrl = new URL(searchRequest.url);
    expect(searchUrl.searchParams.get('query')).toBe('knowledge');
    expect(searchUrl.searchParams.get('page')).toBe('2');

    const [uploadInput, uploadInit] = fetchMock.mock.calls[1] || [];
    expect(uploadInput).toBe('/api/vault/upload-cover');
    expect(uploadInit?.method).toBe('POST');
    expect(uploadInit?.body).toBeInstanceOf(FormData);
  });
});
