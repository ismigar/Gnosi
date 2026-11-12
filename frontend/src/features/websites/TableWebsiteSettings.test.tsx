import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as api from '../../shared/api/sites';
import { TableWebsiteSettings } from './TableWebsiteSettings';
const context = { userId: 'operator', userEmail: '', workspaceId: 'workspace', vaultId: 'vault' };
const translate = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('../../shared/hooks/useRequestContext', () => ({ useRequestContext: () => context }));
vi.mock('../../shared/api/request-context', () => ({ currentRequestContext: () => context }));
vi.mock('../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: () => true }) }));
vi.mock('../../shared/api/sites', () => ({ getTablePublicationSettings: vi.fn(), setTablePublicationSettings: vi.fn() }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); vi.clearAllMocks(); });
async function mount(tableId='articles') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  dispose=()=>{act(()=>{root.unmount();});host.remove();vi.unstubAllGlobals();};
  await act(async()=>{root.render(<TableWebsiteSettings tableId={tableId}/>);await Promise.resolve();});
  return {host,root};
}
it('changes only table eligibility, without duplicating website selection controls', async()=>{
  vi.mocked(api.getTablePublicationSettings).mockResolvedValue({table_id:'articles',publishable:false});
  vi.mocked(api.setTablePublicationSettings).mockResolvedValue({table_id:'articles',publishable:true});
  const {host}=await mount();expect(host.querySelector('select')).toBeNull();expect(host.querySelector('details')).toBeNull();
  expect(api.setTablePublicationSettings).not.toHaveBeenCalled();
  await act(async()=>{host.querySelector<HTMLElement>('[role="switch"]')?.click();await Promise.resolve();});
  expect(api.setTablePublicationSettings).toHaveBeenCalledExactlyOnceWith('articles',true,context,expect.any(AbortSignal));
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
});
it('ignores a late table response after switching tables',async()=>{
  let resolveOld: ((value:{table_id:string;publishable:boolean})=>void) | undefined;
  vi.mocked(api.getTablePublicationSettings).mockImplementation(id=>id==='articles'?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve({table_id:id,publishable:false}));
  const {host,root}=await mount();
  await act(async()=>{root.render(<TableWebsiteSettings tableId="resources"/>);await Promise.resolve();});
  await act(async()=>{resolveOld?.({table_id:'articles',publishable:true});await Promise.resolve();});
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  expect(api.setTablePublicationSettings).not.toHaveBeenCalled();
});
it('preserves eligibility after a failed save and permits retry',async()=>{
  vi.mocked(api.getTablePublicationSettings).mockResolvedValue({table_id:'articles',publishable:false});
  vi.mocked(api.setTablePublicationSettings).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({table_id:'articles',publishable:true});
  const {host}=await mount();
  await act(async()=>{host.querySelector<HTMLElement>('[role="switch"]')?.click();await Promise.resolve();});
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await act(async()=>{host.querySelector<HTMLElement>('[role="switch"]')?.click();await Promise.resolve();});
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
});
