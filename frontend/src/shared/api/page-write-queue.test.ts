import { expect, it, vi } from 'vitest';
import { queuePageWrite } from './page-write-queue';

it('delays the next request until the previous response completes', async () => {
  let finish: (() => void) | undefined;
  const first = queuePageWrite('same-page', () => new Promise<void>(resolve => { finish = resolve; }));
  const write = vi.fn(() => Promise.resolve('next'));
  const second = queuePageWrite('same-page', write);
  await Promise.resolve();
  expect(write).not.toHaveBeenCalled();
  expect(await queuePageWrite('other-page', () => Promise.resolve('independent'))).toBe('independent');
  finish?.();
  await first;
  expect(await second).toBe('next');
  expect(write).toHaveBeenCalledOnce();
});

it('reports failures but permits the next save', async () => {
  const first = queuePageWrite('failed-page', () => Promise.reject(new Error('conflict')));
  const second = queuePageWrite('failed-page', () => Promise.resolve('saved'));
  await expect(first).rejects.toThrow('conflict');
  await expect(second).resolves.toBe('saved');
});
