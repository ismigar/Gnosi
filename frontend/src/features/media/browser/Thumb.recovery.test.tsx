import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {Thumb} from './Thumb';
import {transportFetch} from '../../../shared/api/transports';

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('../../../shared/api/transports', () => ({transportFetch: vi.fn()}));

let container: HTMLDivElement;
let root: Root;
const requestImage = vi.mocked(transportFetch);
const createObjectURL = vi.fn(() => 'blob:recovered-image');
const revokeObjectURL = vi.fn();

const pending = (seconds = '3') => new Response(null, {status: 503, headers: {
  'Retry-After': seconds, 'X-Gnosi-File-Availability': 'pending',
}});
const imageResponse = () => new Response('image bytes', {headers: {'Content-Type': 'image/png'}});
async function run(action: () => void | Promise<void>) {await act(action);}
async function render(src = '/api/vault/images/fixture.png') {
  await run(() => {root.render(<Thumb src={src} alt="Fixture" viewMode="grid" kind="image"/>);});
}
async function failImage() {
  await run(() => {container.querySelector('img')?.dispatchEvent(new Event('error'));});
}
async function advance(ms: number) {await run(async () => {await vi.advanceTimersByTimeAsync(ms);});}

beforeAll(() => {(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;});
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  createObjectURL.mockReturnValue('blob:recovered-image');
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await run(() => {root.unmount();});
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('thumbnail download recovery', () => {
  it('waits for a queued download beyond the old 12-second limit and uses the returned bytes', async () => {
    requestImage.mockResolvedValueOnce(pending()).mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(pending()).mockResolvedValueOnce(imageResponse());
    await render();
    expect(requestImage).not.toHaveBeenCalled();
    await failImage();
    await advance(12_000);
    expect(container.textContent).not.toContain('media.not_downloaded');
    expect(container.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true');
    await advance(6000);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:recovered-image');
    expect(requestImage).toHaveBeenCalledTimes(4);
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({size: 11, type: 'image/png'}));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('respects Retry-After and stops for a reported failure until a manual retry', async () => {
    requestImage.mockResolvedValueOnce(pending('20')).mockResolvedValueOnce(new Response(null, {
      status: 503, headers: {'Retry-After': '30', 'X-Gnosi-File-Availability': 'failed'},
    })).mockResolvedValueOnce(imageResponse());
    await render();
    await failImage();
    await advance(19_000);
    expect(requestImage).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(container.textContent).toContain('media.not_downloaded');
    expect(container.querySelector('button')?.disabled).toBe(true);
    await advance(30_000);
    expect(requestImage).toHaveBeenCalledTimes(2);
    expect(container.querySelector('button')?.disabled).toBe(false);
    await run(() => {container.querySelector('button')?.click();});
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:recovered-image');
  });

  it('stops polling an endless pending download after five minutes and offers retry', async () => {
    requestImage.mockImplementation(() => Promise.resolve(pending()));
    await render();
    await failImage();
    await advance(300_000);
    expect(container.textContent).toContain('media.not_downloaded');
    expect(container.querySelector('button')?.disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const count = requestImage.mock.calls.length;
    await advance(60_000);
    expect(requestImage).toHaveBeenCalledTimes(count);
  });

  it('resets pending state and cancels old requests when the source changes', async () => {
    let signal: AbortSignal | null | undefined;
    let finish: ((value: Response) => void) | undefined;
    requestImage.mockImplementation((_url, init) => {
      signal = init?.signal;
      return new Promise(resolve => {finish = resolve;});
    });
    await render();
    await failImage();
    await render('/api/vault/images/another.png');
    expect(signal?.aborted).toBe(true);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/vault/images/another.png');
    expect(container.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    expect(vi.getTimerCount()).toBe(0);
    await run(() => {finish?.(imageResponse());});
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/vault/images/another.png');
  });

  it('bounds a stalled recovery request and leaves a manual retry available', async () => {
    let signal: AbortSignal | null | undefined;
    requestImage.mockImplementation((_url, init) => {
      signal = init?.signal;
      return new Promise(() => {});
    });
    await render();
    await failImage();
    await advance(20_000);
    expect(signal?.aborted).toBe(true);
    expect(container.textContent).toContain('media.not_downloaded');
    expect(container.querySelector('button')?.disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels scheduled polls and releases recovered image bytes on unmount', async () => {
    requestImage.mockResolvedValueOnce(imageResponse());
    await render();
    await failImage();
    await run(() => {root.render(null);});
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovered-image');
    requestImage.mockResolvedValueOnce(pending());
    await render();
    await failImage();
    await run(() => {root.render(null);});
    expect(vi.getTimerCount()).toBe(0);
    await advance(20_000);
    expect(requestImage).toHaveBeenCalledTimes(2);
  });

  it('does not retry missing or undecodable images indefinitely', async () => {
    requestImage.mockResolvedValueOnce(new Response(null, {status: 404}));
    await render();
    await failImage();
    expect(container.textContent).toContain('media.not_downloaded');
    expect(vi.getTimerCount()).toBe(0);
    requestImage.mockResolvedValueOnce(imageResponse());
    await run(() => {container.querySelector('button')?.click();});
    await failImage();
    expect(container.textContent).toContain('media.not_downloaded');
    expect(requestImage).toHaveBeenCalledTimes(2);
  });
});
