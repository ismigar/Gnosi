import { useId, useMemo, type ReactNode } from 'react';
import { Input } from './components';
import { ThemeAssetPicker } from './ThemeAssetPicker';
import { WebsiteAssetContext, useWebsiteAssets, type WebsiteAssetScope } from './websiteAssetContext';

export function WebsiteAssetProvider({ siteId, context, revision, register, children }: WebsiteAssetScope & { children: ReactNode }) {
  const value = useMemo(() => ({ siteId, context, revision, register }), [siteId, context, revision, register]);
  return <WebsiteAssetContext.Provider value={value}>{children}</WebsiteAssetContext.Provider>;
}
export function WebsiteFileField({ value, label, kind = 'file', onChange }: { value: string; label: string; kind?: 'image' | 'font' | 'file'; onChange: (value: string) => void }) {
  const scope = useWebsiteAssets(); const id = useId();
  return scope ? <ThemeAssetPicker {...scope} assetKey={id} value={value} label={label} kind={kind} disabled={false} onChange={onChange} /> : <Input aria-label={label} value={value} onChange={event => { onChange(event.target.value); }} />;
}
