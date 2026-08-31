/** Match the integrations API without intercepting Vite's source modules. */
export function integrationsDocumentRoute(url: URL): boolean {
  return url.pathname === '/api/integrations';
}

/** Normalize only supported mail API paths for fixture dispatch and assertions. */
export function mailApiPath(url: URL): string | null {
  if (url.pathname.startsWith('/api/mail/')) return url.pathname;
  const scoped = url.pathname.match(/^\/api\/v1\/vaults\/[^/]+\/mail(\/.*)$/);
  const suffix = scoped?.[1];
  return suffix === undefined ? null : `/api/mail${suffix}`;
}

/** Match only the chat endpoint path, including the vault-scoped transport URL. */
export function chatStreamRoute(url: URL): boolean {
  return url.pathname === '/api/chat'
    || /^\/api\/v1\/vaults\/[^/]+\/ai\/chat$/.test(url.pathname);
}
