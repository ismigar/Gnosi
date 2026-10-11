import { queryClient } from './query-client';
import { getActiveVaultId } from './vault-context';
import { emitAppEvent } from '../platform/app-events';
import type { ChatConfirmation } from './chat-confirmations';

const VAULT_WRITES = new Set(['bulk_update_rows', 'replace_reference_ids_in_titles', 'change_schema', 'delete_page', 'delete_table', 'empty_trash', 'restore_page_version']);

/** Refresh once per confirmed batch; a late response never reloads another Vault. */
export async function refreshConfirmedVaultAction(confirmation: ChatConfirmation, status: string, vaultId: string): Promise<void> {
  if (!['completed', 'partial'].includes(status) || typeof confirmation.action !== 'string' || !VAULT_WRITES.has(confirmation.action)) return;
  await queryClient.invalidateQueries({ queryKey: ['bootstrap', 'vault-sidebar', vaultId], exact: true, refetchType: 'none' });
  if ((getActiveVaultId() || '') === vaultId) emitAppEvent('gnosi:invalidatePreview', {});
}
