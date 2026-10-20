import { vi } from 'vitest';

/** Model the browser-wide exclusive queue shared by independent module realms. */
export function installBrowserLocks(): void {
  const queue = new Map<string, Promise<unknown>>();
  const locks = {
    request<T>(name: string, action: (lock: Lock) => T | PromiseLike<T>): Promise<T> {
      const previous = queue.get(name) ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(() => action({ name, mode: 'exclusive' }));
      queue.set(name, current);
      return current;
    },
    query: () => Promise.resolve({ held: [], pending: [] }),
  };
  vi.stubGlobal('navigator', new Proxy(navigator, {
    get(target, key): unknown {
      const value: unknown = key === 'locks' ? locks : Reflect.get(target, key, target);
      return value;
    },
  }));
}
