import type { IntegrationsDocument } from '../../shared/api/integrations';


export interface ContactIntegrationAccount {
  readonly [key: string]: unknown;
  readonly email?: string;
  readonly provider?: string;
  readonly username?: string;
}


export interface ContactIntegrationCatalog {
  readonly accounts: ContactIntegrationAccount[];
  readonly defaultAccount: ContactIntegrationAccount | null;
}


function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}


function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function isContactIntegrationAccount(
  value: unknown,
): value is ContactIntegrationAccount {
  if (!isUnknownRecord(value)) return false;
  return (value.email === undefined || typeof value.email === 'string')
    && (value.provider === undefined || typeof value.provider === 'string')
    && (value.username === undefined || typeof value.username === 'string');
}


function integrationAccounts(value: unknown): ContactIntegrationAccount[] {
  if (!isUnknownArray(value)) return [];
  return value.filter(isContactIntegrationAccount);
}


function accountIdentifier(account: ContactIntegrationAccount): string {
  return account.email ?? account.username ?? '';
}


export function buildContactIntegrationCatalog(
  document: IntegrationsDocument | undefined,
): ContactIntegrationCatalog {
  if (!document) return { accounts: [], defaultAccount: null };
  const accounts = integrationAccounts(document.contacts);
  const allAccounts = [
    ...accounts,
    ...integrationAccounts(document.mail_accounts),
    ...integrationAccounts(document.emails),
  ];
  const defaultId = typeof document.default_contacts === 'string'
    ? document.default_contacts
    : '';
  return {
    accounts,
    defaultAccount: allAccounts.find(
      (account) => accountIdentifier(account) === defaultId,
    ) ?? null,
  };
}
