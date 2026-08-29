import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  correctAiContent,
  fetchAiCatalog,
  fetchAiModelCatalog,
  fetchAiModelComparison,
  fetchAiModelReliability,
  fetchAiModels,
  fetchAiUsage,
  fetchAiUsageHistory,
  generateAiContent,
  updateAiModels,
  type AiCatalog,
  type AiCorrectionInput,
  type AiGenerateInput,
  type AiModelCatalog,
  type AiModelComparison,
  type AiModelReliability,
  type AiModelRegistry,
  type AiModelsPayload,
  type AiUsage,
  type AiUsageHistory,
} from './ai';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

interface RecordedFetchMock {
  readonly mock: {
    readonly calls: ReadonlyArray<readonly [RequestInfo | URL, RequestInit?]>;
  };
}

function requestAt(fetchMock: RecordedFetchMock, index = 0): Request {
  const input = fetchMock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected a Request instance');
  return input;
}

const currency = {
  code: 'EUR',
  fetched_at: '2026-08-29T00:00:00Z',
  source: 'test',
  symbol: '€',
  usd_rate: 0.92,
};

describe('AI API', () => {
  it('loads scoped model reliability evidence', async () => {
    const reliability: AiModelReliability = {
      models: [{
        model_fault_total: 2,
        model_id: 'model-1',
        provider: 'local',
        reasons: { tool_use_failed: 2 },
        top_model_reason: 'tool_use_failed',
        total: 2,
        window_days: 14,
      }],
      window_days: 14,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(reliability),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAiModelReliability(14)).resolves.toEqual(reliability);

    expect(new URL(requestAt(fetchMock).url).searchParams.get('window_days')).toBe(
      '14',
    );
  });

  it('generates and corrects editor content through typed requests', async () => {
    const generatePayload: AiGenerateInput = {
      context: 'Current page',
      language: null,
      mode: 'continue',
      prompt: 'Continue',
    };
    const correctPayload: AiCorrectionInput = {
      language: 'ca',
      scope: 'selection',
      text: 'Text incorrekte',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ content: 'Generated', provider: 'local' }),
      )
      .mockResolvedValueOnce(
        Response.json({ corrected: 'Text correcte', provider: 'local' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateAiContent(generatePayload)).resolves.toEqual({
      content: 'Generated',
      provider: 'local',
    });
    await expect(correctAiContent(correctPayload)).resolves.toEqual({
      corrected: 'Text correcte',
      provider: 'local',
    });

    expect(new URL(requestAt(fetchMock, 0).url).pathname).toBe('/api/ai/generate');
    expect(new URL(requestAt(fetchMock, 1).url).pathname).toBe('/api/ai/correct');
    await expect(requestAt(fetchMock, 0).clone().json()).resolves.toEqual(
      generatePayload,
    );
    await expect(requestAt(fetchMock, 1).clone().json()).resolves.toEqual(
      correctPayload,
    );
  });

  it('loads every typed AI read endpoint without changing its payload', async () => {
    const catalog: AiCatalog = { catalog: { providers: [] }, config: {} };
    const models: AiModelRegistry = {
      budget: {},
      configured_models: [],
      currency,
      default: [],
      models: [],
    };
    const modelCatalog: AiModelCatalog = {
      providers: [],
      schema: 1,
      source: 'test',
    };
    const comparison: AiModelComparison = {
      count: 0,
      currency,
      fetched_at: '2026-08-29T00:00:00Z',
      intelligence_index_version: '1',
      models: [],
      source: 'test',
      source_url: 'https://example.test/models',
    };
    const usage: AiUsage = {
      budget: {},
      cap_ccy: null,
      cap_usd: null,
      currency,
      over_cap: false,
      per_model: [],
      period: '2026-08',
      ratio: null,
      spent_ccy: 0,
      spent_usd: 0,
    };
    const history: AiUsageHistory = { currency, periods: {} };
    const payloads = new Map<string, unknown>([
      ['/api/ai/catalog', catalog],
      ['/api/ai/models', models],
      ['/api/ai/model-catalog', modelCatalog],
      ['/api/ai/model-comparison', comparison],
      ['/api/ai/usage', usage],
      ['/api/ai/usage/history', history],
    ]);
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const request = input instanceof Request ? input : new Request(input);
      const payload = payloads.get(new URL(request.url).pathname);
      return Promise.resolve(Response.json(payload));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAiCatalog()).resolves.toEqual(catalog);
    await expect(fetchAiModels()).resolves.toEqual(models);
    await expect(fetchAiModelCatalog()).resolves.toEqual(modelCatalog);
    await expect(fetchAiModelComparison()).resolves.toEqual(comparison);
    await expect(fetchAiUsage()).resolves.toEqual(usage);
    await expect(fetchAiUsageHistory()).resolves.toEqual(history);

    expect(
      fetchMock.mock.calls.map((_, index) =>
        new URL(requestAt(fetchMock, index).url).pathname,
      ),
    ).toEqual([
      '/api/ai/catalog',
      '/api/ai/models',
      '/api/ai/model-catalog',
      '/api/ai/model-comparison',
      '/api/ai/usage',
      '/api/ai/usage/history',
    ]);
    expect(new URL(requestAt(fetchMock, 2).url).searchParams.has('refresh')).toBe(
      false,
    );
  });

  it('serializes the optional catalog refresh query and forwards cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ providers: [], schema: 1, source: 'test' }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchAiModelCatalog(true, controller.signal);

    const request = requestAt(fetchMock);
    expect(new URL(request.url).searchParams.get('refresh')).toBe('true');
    controller.abort();
    expect(request.signal.aborted).toBe(true);
  });

  it('sends the generated model-registry payload through PUT', async () => {
    const payload: AiModelsPayload = {
      budget: { monthly_usd: 25 },
      models: [{ enabled: true, model_id: 'gpt-5', provider: 'openai' }],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ count: 1, status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateAiModels(payload)).resolves.toEqual({
      count: 1,
      status: 'success',
    });

    const request = requestAt(fetchMock);
    expect(request.method).toBe('PUT');
    expect(new URL(request.url).pathname).toBe('/api/ai/models');
    await expect(request.clone().json()).resolves.toEqual(payload);
  });

  it('normalizes typed API errors through the shared boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { detail: 'AI usage is temporarily unavailable' },
          { status: 503, statusText: 'Service Unavailable' },
        ),
      ),
    );

    await expect(fetchAiUsage()).rejects.toMatchObject({
      message: 'AI usage is temporarily unavailable',
      name: 'GnosiApiError',
      payload: { detail: 'AI usage is temporarily unavailable' },
      status: 503,
    });
  });
});
