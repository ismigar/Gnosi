import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiErrorDetail, GnosiApiError } from './errors';
import {
  addLiteratureCandidates,
  cancelLiteratureSearch,
  captureLiteratureWork,
  createLiteratureActivity,
  createLiteratureReview,
  createLiteratureSearch,
  discoverLiteratureCitations,
  fetchLiteratureReview,
  fetchLiteratureReviews,
  fetchLiteratureSearch,
  fetchLiteratureSearches,
  importLiteratureWorks,
  resolveLiteratureConflict,
  runLiteratureAi,
  submitLiteratureDecision,
  updateLiteratureFullText,
  updateLiteratureReviewSchedule,
} from './literature';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


function requestAt(
  calls: [RequestInfo | URL, RequestInit?][],
  index: number,
): Request {
  const call = calls[index];
  if (!call) throw new Error(`Expected fetch call ${String(index)}`);
  const [input, init] = call;
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
}


const work = {
  id: 'work-1',
  title: 'Federated evidence synthesis',
};


const review = {
  configuration: {},
  criteria: { include: ['Adults'] },
  id: 'review-1',
  protocol: 'Registered protocol',
  question: 'Which interventions work?',
  reviewer_mode: 'single',
  reviewers: ['researcher'],
  status: 'draft',
  title: 'Which interventions work?',
};


const search = {
  errors: [],
  id: 'search-1',
  query: 'open science',
  results: [work],
  state: 'completed',
};


function literatureResponse(input: RequestInfo | URL, init?: RequestInit): Response {
  const request = input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
  const { pathname } = new URL(request.url);

  if (pathname.endsWith('/reviews/review-1/activities')) {
    return Response.json({ id: 'activity-1' }, { status: 201 });
  }
  if (pathname.endsWith('/reviews/review-1/schedule')) {
    return Response.json(review);
  }
  if (pathname.endsWith('/reviews/review-1/snowball')) {
    return Response.json({
      activity_id: 'activity-1',
      counts: { unique_works: 1 },
      exact_queries: { semantic_scholar: ['forward'] },
      provider: 'semantic-scholar',
      works: [work],
    });
  }
  if (pathname.includes('/candidates/candidate-1/decisions')) {
    return Response.json({ conflict: false, decision: {}, phase: 'included' }, {
      status: 201,
    });
  }
  if (pathname.includes('/candidates/candidate-1/consensus')) {
    return Response.json({ conflict: false, decision: {}, phase: 'included' }, {
      status: 201,
    });
  }
  if (pathname.includes('/candidates/candidate-1/full-text')) {
    return Response.json({ id: 'candidate-1', status: 'attached' });
  }
  if (pathname.endsWith('/reviews/review-1/candidates')) {
    return Response.json({
      added: [],
      added_count: 0,
      existing: [],
      existing_count: 0,
    }, { status: 201 });
  }
  if (pathname.endsWith('/reviews/review-1')) {
    return Response.json({
      activities: [],
      candidates: [],
      prisma: {},
      review,
    });
  }
  if (pathname.endsWith('/reviews')) {
    return request.method === 'GET'
      ? Response.json({ reviews: [review] })
      : Response.json(review, { status: 201 });
  }
  if (pathname.endsWith('/searches/search-1')) {
    return Response.json(search);
  }
  if (pathname.endsWith('/searches')) {
    return request.method === 'GET'
      ? Response.json({ searches: [search] })
      : Response.json(search, { status: 202 });
  }
  if (pathname.endsWith('/ai')) {
    return Response.json({
      audit: { model: 'local' },
      operation: 'query_strategy',
      result: { boolean_query: 'open AND science' },
    });
  }
  if (pathname.endsWith('/manual-capture')) {
    return Response.json({ lookup: { source: 'doi' }, work });
  }
  if (pathname.endsWith('/imports')) {
    return Response.json({
      existing: [],
      existing_count: 0,
      imported: [{
        created: true,
        resource_id: 'resource-1',
        title: work.title,
        work_id: work.id,
      }],
      imported_count: 1,
      notebook: null,
      resource_ids: ['resource-1'],
    });
  }
  return Response.json({ detail: 'Unexpected test request' }, { status: 500 });
}


describe('literature API', () => {
  it('keeps review paths and server-owned request defaults unchanged', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) =>
      Promise.resolve(literatureResponse(input, init)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLiteratureReviews()).resolves.toEqual([review]);
    await expect(fetchLiteratureReview('review-1')).resolves.toMatchObject({
      review,
    });
    await createLiteratureReview({
      configuration: {},
      criteria: { include: ['Adults'] },
      protocol: 'Registered protocol',
      question: review.question,
      reviewer_mode: 'single',
      reviewers: ['researcher'],
      title: review.title,
    });
    await addLiteratureCandidates('review-1', { works: [work] });
    await submitLiteratureDecision('review-1', 'candidate-1', {
      decision: 'include',
      notes: '',
      phase: 'title_abstract',
      reason: '',
    });
    await resolveLiteratureConflict('review-1', 'candidate-1', {
      decision: 'include',
      notes: '',
      reason: 'Consensus',
    });
    await updateLiteratureFullText('review-1', 'candidate-1', {
      resource_id: 'resource-1',
      status: 'attached',
    });
    await createLiteratureActivity('review-1', {
      activity_type: 'search_strategy',
      strategy: { query: 'open science' },
    });
    await updateLiteratureReviewSchedule('review-1', {
      enabled: true,
      interval_days: 7,
      strategy: { query: 'open science' },
    });
    await discoverLiteratureCitations('review-1', {
      direction: 'both',
      limit_per_seed: 25,
      seeds: [work],
    });

    const candidatesRequest = requestAt(fetchMock.mock.calls, 3);
    expect(new URL(candidatesRequest.url).pathname).toBe(
      '/api/vault/literature/reviews/review-1/candidates',
    );
    await expect(candidatesRequest.json()).resolves.toEqual({ works: [work] });

    const decisionRequest = requestAt(fetchMock.mock.calls, 4);
    expect(decisionRequest.method).toBe('POST');
    expect(new URL(decisionRequest.url).pathname).toContain(
      '/candidates/candidate-1/decisions',
    );

    const activityRequest = requestAt(fetchMock.mock.calls, 7);
    await expect(activityRequest.json()).resolves.toEqual({
      activity_type: 'search_strategy',
      strategy: { query: 'open science' },
    });
  });


  it('preserves search pagination, AI, manual capture and import payloads', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) =>
      Promise.resolve(literatureResponse(input, init)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLiteratureSearches(50)).resolves.toEqual([search]);
    await fetchLiteratureSearch('search-1', 50, 50);
    await createLiteratureSearch({
      ai_audits: [],
      filters: { languages: ['ca', 'en'] },
      limit_per_source: 25,
      query: 'open science',
      source_ids: ['crossref'],
      source_queries: { crossref: 'open AND science' },
    });
    await cancelLiteratureSearch('search-1');
    await runLiteratureAi({
      agent_id: 'research-agent',
      operation: 'query_strategy',
      payload: { framework: 'AUTO', question: 'open science' },
    });
    await captureLiteratureWork('10.1000/test', 'doi');
    await importLiteratureWorks([work]);

    const historyUrl = new URL(requestAt(fetchMock.mock.calls, 0).url);
    expect(historyUrl.searchParams.get('limit')).toBe('50');

    const pageUrl = new URL(requestAt(fetchMock.mock.calls, 1).url);
    expect(pageUrl.searchParams.get('offset')).toBe('50');
    expect(pageUrl.searchParams.get('limit')).toBe('50');

    const aiRequest = requestAt(fetchMock.mock.calls, 4);
    await expect(aiRequest.json()).resolves.toEqual({
      agent_id: 'research-agent',
      operation: 'query_strategy',
      payload: { framework: 'AUTO', question: 'open science' },
    });

    const importRequest = requestAt(fetchMock.mock.calls, 6);
    await expect(importRequest.json()).resolves.toEqual({ works: [work] });
    expect(importRequest.credentials).toBe('include');
  });


  it('normalizes API detail errors while retaining the established fallback', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.resolve(Response.json(
      { detail: 'Select at least one academic source.' },
      { status: 400, statusText: 'Bad Request' },
    ))));

    let caught: unknown;
    try {
      await createLiteratureSearch({
        ai_audits: [],
        filters: {},
        limit_per_source: 25,
        query: 'open science',
        source_ids: [],
        source_queries: {},
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GnosiApiError);
    expect(apiErrorDetail(caught, 'Fallback')).toBe(
      'Select at least one academic source.',
    );
    expect(apiErrorDetail(new TypeError('offline'), 'Fallback')).toBe('Fallback');
  });
});
