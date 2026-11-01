import fs from 'node:fs';
import path from 'node:path';

export interface AcceptanceAccount { id: string; email: string; password: string }
export interface AcceptanceVault { id: string; slug: string; name: string }
export interface AcceptanceState {
  owner: AcceptanceAccount;
  viewer: AcceptanceAccount;
  workspace_id: string;
  primary_vault: AcceptanceVault;
  secondary_vault: AcceptanceVault;
  table_id: string;
  row_ids: string[];
}

export function ownedAcceptancePath(name: string): string {
  const root = process.env.GNOSI_VALIDATION_ROOT;
  const value = process.env[name];
  if (!root || !value || !path.isAbsolute(value) || !path.resolve(value).startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`${name} must name an owned disposable acceptance file`);
  }
  return value;
}

export function acceptanceState(): AcceptanceState {
  const raw = JSON.parse(fs.readFileSync(ownedAcceptancePath('GNOSI_ACCEPTANCE_STATE'), 'utf8')) as Omit<AcceptanceState, 'primary_vault' | 'secondary_vault' | 'row_ids'> & {
    vaults: { primary: AcceptanceVault; secondary: AcceptanceVault }; page_ids: string[];
  };
  const state: AcceptanceState = { ...raw, primary_vault: raw.vaults.primary, secondary_vault: raw.vaults.secondary, row_ids: raw.page_ids };
  if (!state.primary_vault?.id || !state.primary_vault.slug || !state.secondary_vault?.id
    || !state.workspace_id || !state.table_id || !state.owner?.email || !state.viewer?.email) {
    throw new Error('The real backend acceptance fixture is incomplete');
  }
  return state;
}

export function contextHeaders(state: AcceptanceState, vault = state.primary_vault): Record<string, string> {
  return { 'X-Workspace-ID': state.workspace_id, 'X-Vault-ID': vault.id };
}
