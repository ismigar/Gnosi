import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTitlePreview } from './useTitlePreview';
import type { PageHoverCardProps } from './PageHoverCard';

const mocks = vi.hoisted(() => ({load: vi.fn(), open: vi.fn()}));
vi.mock('./PageHoverCard', () => {
  mocks.load();
  return {PageHoverCard: (props: PageHoverCardProps) => <div role="dialog"
    onMouseEnter={props.onMouseEnter} onMouseLeave={props.onMouseLeave}>
    <span>{props.pageId}:{String(props.viaKeyboard)}</span>
    <button onClick={props.onClose}>Close preview</button>
    <button onClick={() => { props.onOpenPage?.(props.pageId); }}>Open page</button>
  </div>};
});

function Harness() {
  const preview = useTitlePreview({onOpenPage: mocks.open});
  return <>
    <button {...preview.getTitleProps('hover-page')}>Title</button>
    <button onClick={() => { preview.openForKeyboard('keyboard-page', new DOMRect()); }}>Keyboard preview</button>
    {preview.preview}
  </>;
}

it('defers preview code until hover and preserves cancellation, hover delay and keyboard opening', async () => {
  (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const button = (label: string) => {
    const found = [...container.querySelectorAll('button')].find(item => item.textContent === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  try {
    act(() => { root.render(<Harness />); });
    expect(mocks.load).not.toHaveBeenCalled();
    act(() => { button('Title').dispatchEvent(new MouseEvent('mouseover', {bubbles: true})); });
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(container.querySelector('[role=dialog]')).toBeNull();
    act(() => { button('Title').dispatchEvent(new MouseEvent('mouseout', {bubbles: true})); });
    await tick(500);
    expect(container.querySelector('[role=dialog]')).toBeNull();

    act(() => { button('Title').dispatchEvent(new MouseEvent('mouseover', {bubbles: true})); });
    await tick(349);
    expect(container.querySelector('[role=dialog]')).toBeNull();
    await tick(1);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(container.querySelector('[role=dialog]')?.textContent).toContain('hover-page:false');
    act(() => { button('Title').dispatchEvent(new MouseEvent('mouseout', {bubbles: true})); });
    act(() => { container.querySelector('[role=dialog]')?.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})); });
    await tick(200);
    expect(container.querySelector('[role=dialog]')).not.toBeNull();
    act(() => { button('Open page').click(); button('Close preview').click(); });
    expect(mocks.open).toHaveBeenCalledWith('hover-page');
    expect(container.querySelector('[role=dialog]')).toBeNull();

    act(() => { button('Keyboard preview').click(); });
    expect(container.querySelector('[role=dialog]')?.textContent).toContain('keyboard-page:true');
  } finally {
    act(() => { root.unmount(); }); container.remove(); vi.useRealTimers();
  }
});
