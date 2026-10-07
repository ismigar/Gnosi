export const model = { provider: 'fixture', model_id: 'fixture-model', enabled: true, supports_tools: true, context_window: 32000, custom_capability: ['read'] };
export const budget = { monthly_cost_cap: 2, enforce_block: false, preserved_policy: 'fixture' };
const usage = { budget, cap_ccy: 2, cap_usd: 2, currency: { symbol: '€', usd_rate: 1 }, over_cap: false, per_model: [], period: '2026-08', ratio: 0, spent_ccy: 0, spent_usd: 0 };
const account = { mail_server: 'fixture.invalid', mail_port: 110, mail_ssl: 'starttls', email: 'fixture@example.invalid', password_set: true, delete_after_ingest: true };
export const agent = { id: 'fixture-agent', name: 'Fixture agent', provider: 'fixture', model: 'fixture-model', skill_ids: ['fixture-skill'], protected_extension: { keep: true } };
export const configuration = { settings: { workspace_name: 'Fixture', theme: 'dark', custom_setting: 'keep' }, ai: { agents: [agent], active_agent_id: 'fixture-agent', providers: { fixture: { enabled: true, credential_ref: '__keychain__:fixture' } } }, graph: {}, paths: {} };

export interface RecordedRequest { path: string; search: string; method: string; body: unknown }
export interface SettingsApiFixture {
  requests: RecordedRequest[];
  rejectWrites: boolean;
  configResponse?: () => Promise<Response>;
  tableResponse?: () => Promise<Response>;
  databaseRows: { id: string; name: string }[];
  integrationPayload: Record<string, unknown>;
  savedBudget: unknown;
  fetch: typeof fetch;
}

export function createSettingsApiFixture(): SettingsApiFixture {
  const fixture: SettingsApiFixture = {
    requests: [],
    rejectWrites: false,
    databaseRows: [],
    integrationPayload: { mail_accounts: [], contacts: [], calendars: [], extension: { keep: true } },
    savedBudget: { ...budget },
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      const text = request.method === 'GET' ? '' : await request.clone().text();
      const body: unknown = text ? JSON.parse(text) : null;
      fixture.requests.push({ path, search: new URL(request.url).search, method: request.method, body });
      if (fixture.rejectWrites && request.method !== 'GET') return Response.json({ detail: 'Fixture failure' }, { status: 500 });
      if (path === '/api/ai/models' && request.method !== 'GET' && body && typeof body === 'object' && 'budget' in body) fixture.savedBudget = body.budget;
      if (path === '/api/config/editor' && request.method === 'GET' && fixture.configResponse) return fixture.configResponse();
      if (path === '/api/vault/tables' && fixture.tableResponse) return fixture.tableResponse();
      const payloads: Record<string, unknown> = {
        '/api/config/editor': configuration,
        '/api/integrations': fixture.integrationPayload,
        '/api/identity': { full_name: 'Fixture identity', email: 'fixture@example.invalid', address: null },
        '/api/ai/catalog': { config: { providers: { fixture: { enabled: true } } }, catalog: { providers: [] } },
        '/api/ai/models': { configured_models: [model], models: [model], budget: fixture.savedBudget, currency: usage.currency },
        '/api/ai/model-comparison': { models: [] },
        '/api/ai/usage': { ...usage, budget: fixture.savedBudget },
        '/api/vault/tables': [],
        '/api/vault/databases': fixture.databaseRows,
        '/api/graph': { nodes: [], edges: [] },
        '/api/auth/google/status': { configured: false },
        '/api/reader/sources': [],
        '/api/reader/newsletter-account': account,
        '/api/social/networks': [{ id: 'mastodon', name: 'Mastodon', icon: '🐘', enabled: true }],
        '/api/social/streams': [],
        '/api/credentials/deepl_api_key': { has_value: true },
        '/api/env': { SOFTCATALA_API_URL: 'https://fixture.invalid/translate' },
      };
      if (request.method !== 'GET') return Response.json({ status: 'success', success: true, ...account });
      if (!(path in payloads)) throw new Error(`Unexpected fixture request ${path}`);
      return Response.json(payloads[path]);
    },
  };
  return fixture;
}
