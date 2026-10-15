import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyPlanningLevelingProposal,
  createPlanningBaseline,
  fetchProjectSchedule,
  fetchPlanningAllocation,
  fetchPlanningWorklogs,
} from './planning';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('planning API', () => {

  it('supports project-scoped allocation and worklogs while preserving legacy global and task reads', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json({})));
    vi.stubGlobal('fetch', fetchMock);
    await fetchPlanningAllocation('project A');
    await fetchPlanningAllocation();
    await fetchPlanningWorklogs('task 1');
    await fetchPlanningWorklogs(undefined, 'project B');
    const urls = fetchMock.mock.calls.map(([request]) => {
      if (!(request instanceof Request)) throw new Error('Expected a Request instance');
      return new URL(request.url);
    });
    expect(urls[0]?.searchParams.get('project_id')).toBe('project A');
    expect(urls[1]?.search).toBe('');
    expect(urls[2]?.searchParams.get('task_id')).toBe('task 1');
    expect(urls[2]?.searchParams.has('project_id')).toBe(false);
    expect(urls[3]?.searchParams.get('project_id')).toBe('project B');
    expect(urls[3]?.searchParams.has('task_id')).toBe(false);
  });


  it('loads a project schedule through its generated path contract', async () => {
    const payload = {
      criticalTaskIds: [],
      diagnostics: [],
      projectId: 'project 1',
      scheduleRevision: 0,
      tasks: [],
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProjectSchedule('project 1')).resolves.toEqual(payload);
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(new URL(request.url).pathname).toBe('/api/planning/projects/project%201/schedule');
  });


  it('creates a named baseline with its optimistic revision', async () => {
    const baseline = {
      createdAt: '2026-08-29T10:00:00',
      id: 'baseline-1',
      name: 'Launch',
      projectId: 'project-1',
      schedule: {
        criticalTaskIds: [],
        diagnostics: [],
        projectId: 'project-1',
        scheduleRevision: 7,
        tasks: [],
      },
      scheduleRevision: 7,
      type: 'baseline',
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ baseline }, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createPlanningBaseline({
        baseline: { name: 'Launch', schedule_revision: 7 },
        projectId: 'project-1',
      }),
    ).resolves.toEqual(baseline);
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    await expect(request.clone().json()).resolves.toEqual({
      name: 'Launch',
      schedule_revision: 7,
    });
  });


  it('applies a proposal with revision and ETag preconditions', async () => {
    const payload = {
      automaticWrites: [],
      decision: {
        acceptedAt: '2026-08-29T10:00:00',
        appliedChanges: [],
        etags: { task: 'etag-1' },
        id: 'decision-1',
        proposalId: 'proposal-1',
        scheduleRevision: 4,
        type: 'leveling_decision',
      },
      updatedAssignments: [],
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      applyPlanningLevelingProposal({
        proposal: { etags: { task: 'etag-1' }, schedule_revision: 4 },
        proposalId: 'proposal-1',
      }),
    ).resolves.toEqual(payload);
  });
});
