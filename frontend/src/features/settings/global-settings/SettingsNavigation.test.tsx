import { act, lazy, Suspense, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { Settings } from 'lucide-react';
import { expect, it, vi } from 'vitest';
import { SidebarItem } from './SettingsNavigation';
import { settingsPanelLoaders } from './settingsPanelLoaders';

it('keeps navigation usable after a speculative section download fails', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const loader = vi.spyOn(settingsPanelLoaders, 'plugins').mockRejectedValue(new Error('offline'));
  const onClick = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => {
      root.render(<SidebarItem id="plugins" icon={Settings} label="Plugins" active={false} onClick={onClick} />);
    });
    const button = container.querySelector('button');
    await act(async () => { button?.focus(); await Promise.resolve(); });
    expect(loader).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    await act(async () => { button?.click(); await Promise.resolve(); });
    expect(onClick).toHaveBeenCalledOnce();
    expect(button?.disabled).toBe(false);
  } finally {
    act(() => { root.unmount(); });
    container.remove();
    loader.mockRestore();
  }
});

it('keeps the current settings usable until the requested editor has loaded', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let finish: ((module: { default: ComponentType }) => void) | undefined;
  const loading = new Promise<{ default: ComponentType }>((resolve) => { finish = resolve; });
  const Editor = lazy(() => loading);
  function SettingsFixture() {
    const [selected, select] = useState(false);
    return <>
      <SidebarItem icon={Settings} label="Plugins" active={selected} onClick={() => { select(true); }} />
      <Suspense fallback={<div role="status">Loading editor</div>}>
        {selected ? <Editor /> : <input aria-label="Current setting" defaultValue="Saved value" />}
      </Suspense>
    </>;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<SettingsFixture />); await Promise.resolve(); });
    const button = container.querySelector('button');
    const original = container.querySelector('input');
    expect(button).not.toBeNull();
    await act(async () => { button?.click(); await Promise.resolve(); });
    expect(container.querySelector('input')).toBe(original);
    expect(original?.disabled).toBe(false);
    expect(original?.value).toBe('Saved value');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(button?.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      finish?.({ default: () => <input aria-label="Plugin setting" defaultValue="Plugin value" /> });
      await loading;
    });
    expect(container.querySelector('input')?.getAttribute('aria-label')).toBe('Plugin setting');
    expect(button?.getAttribute('aria-busy')).toBe('false');
  } finally {
    await act(async () => { root.unmount(); await Promise.resolve(); });
    container.remove();
  }
});
