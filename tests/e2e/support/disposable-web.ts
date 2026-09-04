import type { BrowserContext, Route } from '@playwright/test';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export interface DisposableNetworkAudit {
  externalRequests: string[];
  unknownApiRequests: string[];
}

const SYNTHETIC_USER = {
  id: 'synthetic-user',
  email: 'web-acceptance@example.invalid',
  name: 'Web Acceptance',
  workspaces: [{ id: 'synthetic-workspace', name: 'Synthetic workspace', role: 'owner' }],
};

const SYNTHETIC_VAULT = {
  id: 'synthetic-vault',
  name: 'Synthetic Knowledge',
  path: '/synthetic/gnosi/vault',
  slug: 'synthetic',
  active: true,
};

const SYNTHETIC_PAGE = {
  id: 'synthetic-page',
  title: 'Synthetic acceptance note',
  content: 'Disposable knowledge content',
  folder: '',
  metadata: { icon: '🧠', tags: ['acceptance'] },
  is_database: false,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function knowledgeEndpoint(pathname: string, suffix: string) {
  return (
    pathname === `/api/vault/${suffix}`
    || pathname === `/api/v1/vaults/synthetic/knowledge/${suffix}`
  );
}

async function syntheticApi(route: Route, audit: DisposableNetworkAudit) {
  const request = route.request();
  const url = new URL(request.url());
  const { pathname } = url;

  if (pathname === '/api/health') {
    return json(route, { status: 'ok', gnosi_mode: 'personal', require_auth: false });
  }
  if (pathname === '/api/auth/me') return json(route, SYNTHETIC_USER);
  if (pathname === '/api/vaults') {
    return json(route, { active_path: SYNTHETIC_VAULT.path, vaults: [SYNTHETIC_VAULT] });
  }
  if (pathname === '/api/config') {
    return json(route, {
      vault_path: SYNTHETIC_VAULT.path,
      active_vault_id: SYNTHETIC_VAULT.id,
      theme: 'system',
      language: 'ca',
    });
  }
  if (pathname === '/api/vault/plugins') {
    return json(route, {
      disabled: [],
      enabled_builtin: ['calendar', 'contacts', 'feeds-reader', 'grounded-notebooks', 'mail'],
      enabled_third_party: [],
      settings: {},
    });
  }
  if (pathname === '/api/vault/plugins/installed') return json(route, { plugins: [] });
  if (pathname === '/api/vault/registry') {
    return json(route, { databases: [], tables: [], views: [] });
  }
  if (pathname === '/api/vault/tables') return json(route, []);
  if (pathname === '/api/vault/reference-table') {
    return json(route, { configured: false, table_id: null });
  }
  if (pathname === '/api/vault/brain-table') {
    return json(route, {
      configured: false,
      index_field_ids: [],
      name: null,
      source_table_ids: [],
      table_id: null,
    });
  }
  if (knowledgeEndpoint(pathname, 'pages')) return json(route, [SYNTHETIC_PAGE]);
  if (knowledgeEndpoint(pathname, 'pages/synthetic-page')) return json(route, SYNTHETIC_PAGE);
  if (pathname === '/api/vault/resolve-by-title') {
    return json(route, {
      folder: '',
      id: SYNTHETIC_PAGE.id,
      matched_alias: null,
      title: SYNTHETIC_PAGE.title,
    });
  }
  if (pathname === '/api/vault/pages/synthetic-page/inline-comments') return json(route, []);
  if (pathname === '/api/vault/backlinks') return json(route, []);
  if (pathname === '/api/vault/outlinks') {
    return json(route, { links: [], relations: [], unresolved: [] });
  }
  if (pathname === '/api/vault/unlinked-mentions') return json(route, []);
  if (pathname === '/api/vault/favorites') return json(route, []);
  if (pathname === '/api/vault/recent') return json(route, []);
  if (pathname === '/api/vault/trash') return json(route, []);
  if (pathname === '/api/vault/tags') return json(route, []);
  if (pathname === '/api/vault/backlinks/synthetic-page') return json(route, []);
  if (pathname === '/api/vault/outgoing-links/synthetic-page') return json(route, []);
  if (pathname === '/api/vault/page-index/status') return json(route, { status: 'ready' });
  if (pathname === '/api/vault/page-index') return json(route, { pages: [SYNTHETIC_PAGE] });
  if (pathname === '/api/integrations') return json(route, []);
  if (
    pathname === '/api/calendar/accounts'
    || pathname === '/api/calendar/calendars'
    || pathname === '/api/calendar/events'
  ) return json(route, []);
  if (
    pathname === '/api/mail/accounts'
    || pathname === '/api/mail/messages'
    || pathname === '/api/mail/views'
    || pathname === '/api/mail/tags'
  ) return json(route, []);
  if (pathname === '/api/v1/vaults/synthetic/mail/events') {
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'event: ready\ndata: {}\n\n',
    });
  }
  if (pathname === '/api/contacts' || pathname === '/api/notebooks') return json(route, []);
  if (pathname === '/api/brain/status') return json(route, { status: 'ready' });
  if (pathname === '/api/reference-libraries') return json(route, []);
  if (pathname === '/api/notifications') return json(route, []);
  if (pathname === '/api/system/notifications' && request.method() === 'GET') {
    return json(route, { has_more: false, items: [], limit: 50, offset: 0, total: 0 });
  }
  if (pathname === '/api/system/notifications' && request.method() === 'POST') {
    return json(route, {
      created_at: '2000-01-01T00:00:00Z',
      id: 'synthetic-notification',
      is_read: false,
      level: 'INFO',
      message: '',
      title: 'Synthetic notification',
      workspace_id: 'synthetic-workspace',
    });
  }

  audit.unknownApiRequests.push(`${request.method()} ${pathname}`);
  return json(route, { detail: 'Undeclared synthetic endpoint' }, 501);
}

export async function installDisposableNetwork(context: BrowserContext): Promise<DisposableNetworkAudit> {
  const audit: DisposableNetworkAudit = { externalRequests: [], unknownApiRequests: [] };
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      audit.externalRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await syntheticApi(route, audit);
      return;
    }
    await route.continue();
  });
  return audit;
}

export async function seedDisposableBrowser(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem('gnosi_user_id', 'synthetic-user');
    localStorage.setItem('gnosi_user_email', 'web-acceptance@example.invalid');
    localStorage.setItem('gnosi_workspace_id', 'synthetic-workspace');
    localStorage.setItem('gnosi_role', 'owner');
    localStorage.setItem('activeVaultId', 'synthetic-vault');
    localStorage.setItem('i18nextLng', 'ca');
    localStorage.removeItem('gnosi-release-notes-seen');
  });
}
