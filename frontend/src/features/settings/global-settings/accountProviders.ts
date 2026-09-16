import { MICROSOFT_MAIL_DOMAINS } from '../../../shared/api/microsoft-auth';

export type AccountProvider = 'google' | 'microsoft' | 'icloud' | 'yahoo' | 'aol';

const providerDomains: Record<AccountProvider, readonly string[]> = {
  google: ['gmail.com', 'googlemail.com'],
  microsoft: MICROSOFT_MAIL_DOMAINS,
  icloud: ['icloud.com', 'me.com', 'mac.com'],
  yahoo: ['yahoo.com', 'ymail.com', 'yahoo.es'],
  aol: ['aol.com'],
};

export function isCompleteAccountEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function accountProviderForEmail(email: string): AccountProvider | null {
  if (!isCompleteAccountEmail(email)) return null;
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  for (const provider of Object.keys(providerDomains) as AccountProvider[]) {
    if (providerDomains[provider].includes(domain)) return provider;
  }
  return null;
}
