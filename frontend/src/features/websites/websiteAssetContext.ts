import { createContext, useContext } from 'react';
import type { RequestContext } from '../../shared/api/request-context';
import type { RegisterAutosave } from './autosaveRequest';

export interface WebsiteAssetScope { siteId: string; context: RequestContext; revision?: number; register?: RegisterAutosave }
export const WebsiteAssetContext = createContext<WebsiteAssetScope | null>(null);
export function useWebsiteAssets() { return useContext(WebsiteAssetContext); }
