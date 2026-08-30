import { describe, expect, it, vi } from 'vitest';

import {
  detectEmbedKind,
  getImageRetryDelay,
  isDismissedEmbedPickerError,
  isLocalFileEmbedUrl,
  normalizeEmbedUrl,
  readEmbedBlockText,
  readInsertResultUrl,
  toVimeoEmbedUrl,
  toYouTubeEmbedUrl,
} from './embedRendererModel';


const ORIGIN = 'https://gnosi.test';


describe('embedRendererModel', () => {
  it('normalizes every supported Vault asset form', () => {
    const resolveVaultUrl = vi.fn<(url: string) => string>(
      (url) => `vault:${url}`,
    );

    expect(normalizeEmbedUrl(null, resolveVaultUrl)).toBe('');
    expect(normalizeEmbedUrl('  ', resolveVaultUrl)).toBe('');
    expect(normalizeEmbedUrl(
      ' Assets/Research/figure.svg ',
      resolveVaultUrl,
    )).toBe('vault:/api/vault/assets/Research/figure.svg');
    expect(normalizeEmbedUrl(
      '/api/vault/assets/Paper.pdf',
      resolveVaultUrl,
    )).toBe('vault:/api/vault/assets/Paper.pdf');
    expect(normalizeEmbedUrl(
      'https://old.test/api/vault/assets/Audio/talk.mp3',
      resolveVaultUrl,
    )).toBe('vault:/api/vault/assets/Audio/talk.mp3');
    expect(normalizeEmbedUrl(
      ' https://example.com/embed ',
      resolveVaultUrl,
    )).toBe('https://example.com/embed');
    expect(resolveVaultUrl).toHaveBeenCalledTimes(3);
  });


  it('detects all media and provider formats before iframe fallback', () => {
    expect(detectEmbedKind('', ORIGIN)).toBe('empty');
    expect(detectEmbedKind('/paper.PDF?download=1', ORIGIN)).toBe('pdf');
    expect(detectEmbedKind('/clip.m4v#time=2', ORIGIN)).toBe('video');
    expect(detectEmbedKind('/interview.flac', ORIGIN)).toBe('audio');
    expect(detectEmbedKind('/diagram.avif', ORIGIN)).toBe('image');
    expect(detectEmbedKind('https://www.youtube.com/watch?v=id', ORIGIN))
      .toBe('youtube');
    expect(detectEmbedKind('https://m.youtube.com/shorts/id', ORIGIN))
      .toBe('youtube');
    expect(detectEmbedKind('https://player.vimeo.com/video/123', ORIGIN))
      .toBe('vimeo');
    expect(detectEmbedKind('relative/dashboard', ORIGIN)).toBe('iframe');
    expect(detectEmbedKind('http://[broken', ORIGIN)).toBe('iframe');
  });


  it('builds the legacy YouTube embed URLs', () => {
    expect(toYouTubeEmbedUrl('https://youtu.be/short-id', ORIGIN)).toBe(
      'https://www.youtube.com/embed/short-id',
    );
    expect(toYouTubeEmbedUrl(
      'https://www.youtube.com/watch?v=watch-id',
      ORIGIN,
    )).toBe('https://www.youtube.com/embed/watch-id');
    expect(toYouTubeEmbedUrl(
      'https://youtube.com/shorts/shorts-id/extra',
      ORIGIN,
    )).toBe('https://www.youtube.com/embed/shorts-id');
    expect(toYouTubeEmbedUrl(
      'https://youtube.com/embed/already-embedded',
      ORIGIN,
    )).toBe('https://youtube.com/embed/already-embedded');
    expect(toYouTubeEmbedUrl('http://[broken', ORIGIN)).toBe(
      'http://[broken',
    );
  });


  it('preserves Vimeo player links and supports public and unlisted videos', () => {
    expect(toVimeoEmbedUrl('https://vimeo.com/123456', ORIGIN)).toBe(
      'https://player.vimeo.com/video/123456',
    );
    expect(toVimeoEmbedUrl(
      'https://vimeo.com/channels/staffpicks/123456/private-hash',
      ORIGIN,
    )).toBe(
      'https://player.vimeo.com/video/123456?h=private-hash',
    );
    expect(toVimeoEmbedUrl(
      'https://player.vimeo.com/video/123456?h=private-hash',
      ORIGIN,
    )).toBe('https://player.vimeo.com/video/123456?h=private-hash');
    expect(toVimeoEmbedUrl('https://vimeo.com/channels/staff', ORIGIN)).toBe(
      'https://vimeo.com/channels/staff',
    );
  });


  it('models retries, local URLs, block text, results and dismissed errors', () => {
    expect(getImageRetryDelay(0)).toBe(500);
    expect(getImageRetryDelay(1)).toBe(1000);
    expect(getImageRetryDelay(3)).toBe(4000);
    expect(getImageRetryDelay(39)).toBe(4000);
    expect(getImageRetryDelay(40)).toBeNull();
    expect(isLocalFileEmbedUrl('/api/vault/local-file/token')).toBe(true);
    expect(isLocalFileEmbedUrl('/api/vault/assets/file.pdf')).toBe(false);
    expect(readEmbedBlockText({
      props: { caption: '  Caption  ', url: 42 },
    })).toEqual({ caption: 'Caption', rawUrl: '42' });
    expect(readEmbedBlockText(null)).toEqual({ caption: '', rawUrl: '' });
    expect(readInsertResultUrl({ url: 'Assets/file.pdf' })).toBe(
      'Assets/file.pdf',
    );
    expect(readInsertResultUrl({ url: '' })).toBeNull();
    expect(readInsertResultUrl({ url: 42 })).toBeNull();
    expect(isDismissedEmbedPickerError(new Error('picker cancelled'))).toBe(
      true,
    );
    expect(isDismissedEmbedPickerError({ message: 'request superseded' }))
      .toBe(true);
    expect(isDismissedEmbedPickerError(new Error('network failure'))).toBe(
      false,
    );
  });
});
