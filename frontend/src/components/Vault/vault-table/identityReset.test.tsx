import { StrictMode, act, useLayoutEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../test/mount-react';
import { useTableIdentity } from './useTableIdentity';

interface ConfigFixture {
  config: unknown;
  processed_resources?: unknown;
  resource_statuses?: unknown;
}
const fixture = vi.hoisted(() => ({
  reader: (_id: string): boolean => false,
  fetchConfig: vi.fn<() => Promise<ConfigFixture>>(),
}));
vi.mock('../../../plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: fixture.reader, getPluginSettings: () => ({}) }) }));
vi.mock('../../../shared/api/brain', () => ({ fetchLlmWikiConfig: fixture.fetchConfig }));
vi.mock('../../../context/auth-context', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../../hooks/useLocaleSettings', () => ({ useLocaleSettings: () => ({}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ca' } }) }));

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve: (value: T) => { if (!resolve) throw new Error('Missing promise resolver'); resolve(value); } };
}
function mountIdentity() {
  let model: ReturnType<typeof useTableIdentity> | undefined;
  function Probe() {
    const value = useTableIdentity({});
    useLayoutEffect(() => { model = value; });
    return <output>{value.llmWikiConfig ? 'configured' : 'empty'}</output>;
  }
  const mounted = mountTestComponent(<StrictMode><Probe /></StrictMode>);
  return {
    ...mounted,
    model: () => { if (!model) throw new Error('Identity not mounted'); return model; },
    setEnabled: (enabled: boolean) => {
      fixture.reader = id => id === 'llm-wiki' && enabled;
      mounted.render(<StrictMode><Probe /></StrictMode>);
    },
  };
}
beforeEach(() => {
  fixture.reader = () => false;
  fixture.fetchConfig.mockReset();
});

describe('table plugin input reset', () => {
  it('resets disabled configuration, retains jobs and reloads without resurrecting the old config', async () => {
    const table = mountIdentity();
    expect(fixture.fetchConfig).not.toHaveBeenCalled();
    fixture.fetchConfig.mockResolvedValueOnce({ config: { marker: 'first' }, resource_statuses: { fixture: { a: { running: true } } } });
    await act(async () => { table.setEnabled(true); await Promise.resolve(); });
    expect(table.model().llmWikiConfig).toMatchObject({ marker: 'first' });
    table.setEnabled(false);
    expect(table.model().llmWikiConfig).toBeNull();
    expect(table.model().llmWikiJobs.fixture?.a?.running).toBe(true);
    const pending = deferred<ConfigFixture>();
    fixture.fetchConfig.mockReturnValueOnce(pending.promise);
    table.setEnabled(true);
    expect(table.model().llmWikiConfig).toBeNull();
    await act(async () => { pending.resolve({ config: { marker: 'second' } }); await pending.promise; });
    expect(table.model().llmWikiConfig).toMatchObject({ marker: 'second' });
  });

  it('retains loaded configuration during an enabled refresh and ignores a response cancelled by disable', async () => {
    const table = mountIdentity();
    fixture.fetchConfig.mockResolvedValueOnce({ config: { marker: 'loaded' } });
    await act(async () => { table.setEnabled(true); await Promise.resolve(); });
    const pending = deferred<ConfigFixture>();
    fixture.fetchConfig.mockReturnValueOnce(pending.promise);
    table.setEnabled(true);
    expect(table.model().llmWikiConfig).toMatchObject({ marker: 'loaded' });
    table.setEnabled(false);
    await act(async () => { pending.resolve({ config: { marker: 'obsolete' }, resource_statuses: { obsolete: {} } }); await pending.promise; });
    expect(table.model().llmWikiConfig).toBeNull();
    expect(table.model().llmWikiJobs).toEqual({});
  });

  it('preserves invalid-config guards and discards responses after unmount', async () => {
    const table = mountIdentity();
    fixture.fetchConfig.mockResolvedValueOnce({ config: [], processed_resources: null });
    await act(async () => { table.setEnabled(true); await Promise.resolve(); });
    expect(table.model().llmWikiConfig).toBeNull();
    const pending = deferred<ConfigFixture>();
    fixture.fetchConfig.mockReturnValueOnce(pending.promise);
    table.setEnabled(true);
    const before = table.model();
    table.unmount();
    await act(async () => { pending.resolve({ config: { marker: 'too late' } }); await pending.promise; });
    expect(table.model()).toBe(before);
  });
});
