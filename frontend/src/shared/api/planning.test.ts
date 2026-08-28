import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyPlanningLevelingProposal,
  createPlanningBaseline,
  fetchProjectSchedule,
} from './planning';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('planning API', () => {
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
