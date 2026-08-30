import { fetchAiModels } from '../../../shared/api/ai';
import { fetchVaultSummarySettings } from '../../../shared/api/vault-summary';
import { fetchVaultPages, fetchVaultPagesByTable } from '../../../shared/api/vaults';
import {
    createVaultView,
    deleteVaultView,
    fetchVaultView,
    fetchVaultViews,
    fetchVaultViewUsage,
    updateVaultView,
    upsertPageView,
} from '../../../shared/api/vault-views';

export const PAGE_VIEW_MODAL_API = Object.freeze({
    createVaultView,
    deleteVaultView,
    fetchAiModels,
    fetchVaultPages,
    fetchVaultPagesByTable,
    fetchVaultSummarySettings,
    fetchVaultView,
    fetchVaultViews,
    fetchVaultViewUsage,
    updateVaultView,
    upsertPageView,
});
