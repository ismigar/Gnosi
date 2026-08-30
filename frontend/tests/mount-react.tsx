import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

const cleanups = new Set<() => void>();

beforeAll(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { for (const cleanup of [...cleanups]) cleanup(); });
afterAll(() => { vi.unstubAllGlobals(); });

/** Mount real React effects with deterministic, idempotent cleanup in unit tests. */
export function mountTestComponent(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (next: ReactElement): void => {
    act(() => { root.render(next); });
  };
  const unmount = (): void => {
    if (!cleanups.delete(unmount)) return;
    act(() => { root.unmount(); });
    container.remove();
  };
  cleanups.add(unmount);
  render(element);
  return { container, render, unmount };
}
