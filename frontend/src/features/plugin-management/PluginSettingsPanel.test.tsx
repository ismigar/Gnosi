import { describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { PluginSettingsPanel } from './PluginSettingsPanel';

const { mount, cleanup } = vi.hoisted(() => ({ mount: vi.fn(), cleanup: vi.fn() }));
vi.mock('../../shared/plugins/host', () => ({ mountSettingsPanel: mount }));

describe('settings panel effect identity', () => {
  it('keeps the live iframe when contribution snapshots change object identity', () => {
    mount.mockReset().mockReturnValue(cleanup); cleanup.mockReset();
    const panel = { pluginId: 'fixture', id: 'settings', title: 'Original', height: 300 };
    const view = mountTestComponent(<PluginSettingsPanel panel={panel} />);
    expect(mount).toHaveBeenCalledOnce();
    view.render(<PluginSettingsPanel panel={{ ...panel, title: 'Updated title' }} />);
    expect(view.container.textContent).toContain('Updated title');
    expect(mount).toHaveBeenCalledOnce(); expect(cleanup).not.toHaveBeenCalled();
    view.render(<PluginSettingsPanel panel={{ ...panel, id: 'other' }} />);
    expect(mount).toHaveBeenCalledTimes(2); expect(cleanup).toHaveBeenCalledOnce();
    view.render(<PluginSettingsPanel panel={null} />);
    expect(cleanup).toHaveBeenCalledTimes(2); expect(view.container.children).toHaveLength(0);
    view.unmount(); expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
