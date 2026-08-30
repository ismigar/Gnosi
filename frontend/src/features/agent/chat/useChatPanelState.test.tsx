import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { chatPanelReducer, useChatPanelState } from './useChatPanelState';

beforeAll(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
describe('chat panel mode transitions', () => {
  it('opens and expands a floating panel when embedding changes to true', () => {
    expect(chatPanelReducer({ embedded: false, isOpen: false, isMinimized: true }, { type: 'embedding', value: true })).toEqual({ embedded: true, isOpen: true, isMinimized: false });
  });
  it('preserves the current open/minimized state when embedding changes back to false', () => {
    expect(chatPanelReducer({ embedded: true, isOpen: true, isMinimized: false }, { type: 'embedding', value: false })).toEqual({ embedded: false, isOpen: true, isMinimized: false });
  });
  it('supports React-style functional updates without resetting the other panel field', () => {
    const state = { embedded: false, isOpen: true, isMinimized: false };
    expect(chatPanelReducer(state, { type: 'open', value: true })).toBe(state);
    const minimized = chatPanelReducer(state, { type: 'minimized', value: old => !old });
    expect(minimized).toEqual({ ...state, isMinimized: true });
    expect(chatPanelReducer(minimized, { type: 'open', value: old => !old })).toEqual({ ...minimized, isOpen: false });
  });
  it('commits the correct mode without effects and keeps independent user toggles working', async () => {
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    function Harness({ embedded }: { embedded: boolean }) {
      const state = useChatPanelState(embedded);
      return <div>
        <output>{`${String(state.isOpen)}:${String(state.isMinimized)}`}</output>
        <button type="button" onClick={() => { state.setIsOpen(value => !value); }}>Open</button>
        <button type="button" onClick={() => { state.setIsMinimized(value => !value); }}>Minimize</button>
      </div>;
    }
    const render = async (embedded: boolean) => { await act(async () => { root.render(<Harness embedded={embedded} />); await Promise.resolve(); }); };
    const click = async (index: number) => {
      const button = container.querySelectorAll('button')[index]; if (!button) throw new Error('Missing panel control');
      await act(async () => { button.click(); await Promise.resolve(); });
    };
    try {
      await render(false); expect(container.querySelector('output')?.textContent).toBe('false:false');
      await click(0); await click(1); expect(container.querySelector('output')?.textContent).toBe('true:true');
      await render(true); expect(container.querySelector('output')?.textContent).toBe('true:false');
      await render(false); expect(container.querySelector('output')?.textContent).toBe('true:false');
      await click(0); expect(container.querySelector('output')?.textContent).toBe('false:false');
      await render(false); expect(container.querySelector('output')?.textContent).toBe('false:false');
    } finally {
      await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove();
    }
  });
});
