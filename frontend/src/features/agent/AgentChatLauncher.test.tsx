import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loaded: 0 }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('./AgentChat', () => {
  mocks.loaded += 1;
  return { default: () => <div data-testid="loaded-agent-chat" /> };
});

import { AgentChatLauncher } from './AgentChatLauncher';

describe('AgentChatLauncher', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.loaded = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    delete document.body.dataset.gnosiFloatingDock;
    vi.unstubAllGlobals();
  });

  it('loads the complete agent only after the launcher is used', async () => {
    act(() => { root.render(<AgentChatLauncher />); });
    expect(mocks.loaded).toBe(0);

    const launcher = container.querySelector('.premium-chat-trigger');
    if (!(launcher instanceof HTMLButtonElement)) {
      throw new Error('Missing lightweight agent launcher');
    }
    await act(async () => {
      launcher.click();
      await Promise.resolve();
    });

    expect(mocks.loaded).toBe(1);
    expect(container.querySelector('[data-testid="loaded-agent-chat"]')).not.toBeNull();
  });
});
