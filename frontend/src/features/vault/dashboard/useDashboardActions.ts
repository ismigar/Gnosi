import { useDashboardState } from './useDashboardState';
import { useRecordCatalog } from './useRecordCatalog';
import { useGlobalIndex } from './useGlobalIndex';
import { useDataLoading } from './useDataLoading';
import { useNavigationHistory } from './useNavigationHistory';
import { usePageLoading } from './usePageLoading';
import { useViewCatalog } from './useViewCatalog';
import { useTableNavigation } from './useTableNavigation';
import { useDocumentTabs } from './useDocumentTabs';
import { useTemplates } from './useTemplates';
import { useSources } from './useSources';
import { useContentCreation } from './useContentCreation';
import { useViewActions } from './useViewActions';
import { useEditorUpdates } from './useEditorUpdates';
import { usePageDeletion } from './usePageDeletion';
import { useRelationHistory } from './useRelationHistory';
import { useUndoRedo } from './useUndoRedo';
import { usePageMutations } from './usePageMutations';
import { useExternalCatalogRefresh } from './useExternalCatalogRefresh';
import { fetchVaultPages, fetchVaultSidebarSummary, fetchVaultGlobalIndex } from '../../../shared/api/vaults';
import { readPages } from './readers';
export function useDashboardActions() {
    const state = useDashboardState();
    const records = useRecordCatalog(state);
    const index = useGlobalIndex(state);
    const data = useDataLoading({ ...state, ...records, ...index });
    useExternalCatalogRefresh(async signal => {
        const [pages, globalIndex] = await Promise.all([
            state.fullPageCatalogLoadedRef.current ? fetchVaultPages({}, signal) : fetchVaultSidebarSummary(signal),
            fetchVaultGlobalIndex(signal),
        ]);
        return { pages: readPages(pages), globalIndex };
    }, ({ pages, globalIndex }) => {
        // Catalog/search state is separate from tabs and editor document state.
        // Do not call loadPage or replace editor content on external changes.
        records.syncPagesState(pages);
        state.setGlobalIndex(globalIndex);
    });
    const navigation = useNavigationHistory(state);
    const loading = usePageLoading({ ...state, ...records, ...data, ...navigation });
    const catalog = useViewCatalog({ ...state, ...data });
    const tables = useTableNavigation({ ...state, ...records, ...data, ...navigation, ...catalog });
    const tabs = useDocumentTabs({ ...state, ...tables, ...loading, ...navigation });
    const base = { ...state, ...records, ...index, ...data, ...navigation, ...loading, ...catalog, ...tables, ...tabs };
    const templates = useTemplates(base);
    const sources = useSources(base);
    const creation = useContentCreation(base);
    const views = useViewActions(base);
    const editor = useEditorUpdates(base);
    const deletion = usePageDeletion(base);
    const relations = useRelationHistory(base);
    const history = useUndoRedo({ ...base, ...relations });
    const mutations = usePageMutations(base);
    return { ...base, ...templates, ...sources, ...creation, ...views, ...editor, ...deletion, ...relations, ...history, ...mutations };
}
export type DashboardActions = ReturnType<typeof useDashboardActions>;
