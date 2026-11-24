import type { RequestContext } from '../../../shared/api/request-context';
import { patchVaultPage, type VaultPagePatchInput } from '../../../shared/api/vaults';

/** Auto-saves can run during cleanup, or after another page write in the queue. */
export function patchEditedPage(scope: RequestContext, pageId: string, input: VaultPagePatchInput) {
  return scope.vaultId ? patchVaultPage(pageId, input, { context: scope, allowLocalSession: true }) : patchVaultPage(pageId, input);
}
