import { createContext, useContext, useId, useMemo, type ReactNode } from 'react';
import type { RequestContext } from '../../shared/api/request-context';
import type { RegisterAutosave } from './autosaveRequest';
import { Input } from './components';
import { ThemeAssetPicker } from './ThemeAssetPicker';

interface AssetScope { siteId: string; context: RequestContext; revision?: number; register?: RegisterAutosave }
const AssetContext = createContext<AssetScope | null>(null);
export function WebsiteAssetProvider({ siteId, context, revision, register, children }: AssetScope & { children: ReactNode }) {
  const value = useMemo(() => ({ siteId, context, revision, register }), [siteId, context, revision, register]);
  return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>;
}
export function WebsiteFileField({ value, label, kind = 'file', onChange }: { value: string; label: string; kind?: 'image' | 'font' | 'file'; onChange: (value: string) => void }) {
  const scope = useContext(AssetContext); const id = useId();
  return scope ? <ThemeAssetPicker {...scope} assetKey={id} value={value} label={label} kind={kind} disabled={false} onChange={onChange} /> : <Input aria-label={label} value={value} onChange={event => { onChange(event.target.value); }} />;
}
