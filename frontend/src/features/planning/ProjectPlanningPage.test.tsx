import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectPlanningPage from './ProjectPlanningPage';


const mocks = vi.hoisted(() => ({
  applyProposal: vi.fn(),
  createBaseline: vi.fn(),
  createProposal: vi.fn(),
  createWorklog: vi.fn(),
  refetch: vi.fn(),
  pluginSettings: vi.fn(),
  projectReferences: vi.fn(),
  projectQuery: vi.fn(),
  baselinesQuery: vi.fn(),
  allocationQuery: vi.fn(),
  worklogsQuery: vi.fn(),
}));


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('../../shared/ui/layout/AppHeader', () => ({
  AppHeader: ({
    children,
    title,
  }: {
    children?: React.ReactNode;
    title: React.ReactNode;
  }) => <header><h1>{title}</h1>{children}</header>,
}));


vi.mock('../../shared/record-views/VaultTimeline', () => ({
  VaultTimeline: () => <div>Timeline</div>,
}));


vi.mock('../../shared/plugins/usePlugins', () => ({
  usePlugins: () => ({ getPluginSettings: mocks.pluginSettings, loaded: true, loadError: false }),
}));


vi.mock('../../shared/api/vaults', () => ({
  fetchVaultPageReferencesByTable: mocks.projectReferences,
}));


vi.mock('../../shared/api/usePlanningData', () => ({
  planningQueryKeys: {
    projectReferences: (tableId: string) => ['planning', 'test-vault', 'project-references', tableId],
  },
  useApplyPlanningLevelingProposal: () => ({ mutateAsync: mocks.applyProposal }),
  useCreatePlanningBaseline: () => ({ mutateAsync: mocks.createBaseline }),
  useCreatePlanningLevelingProposal: () => ({ mutateAsync: mocks.createProposal }),
  useCreatePlanningWorklog: () => ({ mutateAsync: mocks.createWorklog }),
  usePlanningAllocation: (projectId: string, enabled: boolean) => {
    mocks.allocationQuery(projectId, enabled);
    return ({
    data: {
      assignment_summaries: [],
      buckets: [],
      revision: 1,
      total_estimated_cost: 1200,
      warnings: [],
    },
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
  });
  },
  usePlanningBaselines: (projectId: string, enabled: boolean) => {
    mocks.baselinesQuery(projectId, enabled);
    return {
    data: { baselines: [] },
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
    };
  },
  usePlanningWorklogs: (projectId: string, enabled: boolean) => {
    mocks.worklogsQuery(projectId, enabled);
    return ({
    data: { worklogs: [] },
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
  });
  },
  useProjectSchedule: (projectId: string, enabled: boolean) => {
    mocks.projectQuery(projectId, enabled);
    return {
    data: {
      criticalTaskIds: ['task-1'],
      diagnostics: [{ code: 'warning', message: 'Needs review' }],
      projectId: 'default',
      scheduleRevision: 3,
      tasks: [{
        critical: true,
        end: '2026-08-31',
        freeSlackMinutes: 0,
        id: 'task-1',
        start: '2026-08-29',
        title: 'Plan migration',
      }],
    },
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
    };
  },
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

function renderPage(): void {
  root.render(<QueryClientProvider client={queryClient}><ProjectPlanningPage /></QueryClientProvider>);
}


function setControlValue(
  control: HTMLInputElement | HTMLSelectElement,
  value: string,
): void {
  const prototype = control instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (!descriptor?.set) {
    throw new Error('Native form value setter is unavailable');
  }
  const setValue = descriptor.set.bind(control) as (nextValue: string) => void;
  setValue(value);
  control.dispatchEvent(new Event(
    control instanceof HTMLSelectElement ? 'change' : 'input',
    { bubbles: true },
  ));
}


beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.resetAllMocks();
  mocks.pluginSettings.mockReturnValue({});
  mocks.projectReferences.mockResolvedValue([]);
  mocks.refetch.mockResolvedValue({ data: {} });
  mocks.createBaseline.mockResolvedValue({ id: 'baseline-1' });
  mocks.createWorklog.mockResolvedValue({ id: 'worklog-1' });
  mocks.createProposal.mockResolvedValue({
    automatic_apply_supported: true,
    createdAt: '2026-08-29T12:00:00Z',
    id: 'proposal-1',
    projectId: 'default',
    proposals: [{ assignmentId: 'assignment-1' }],
    revision: 2,
    scheduleRevision: 3,
    sourceEtags: { 'task-1': 'etag-1' },
    status: 'pending',
    type: 'leveling_proposal',
    warnings: [],
  });
  mocks.applyProposal.mockResolvedValue({ status: 'applied' });
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  queryClient.clear();
});


describe('ProjectPlanningPage', () => {
  it.each([['2.5', 2.5], ['-1', -1]])('renders the typed schedule and creates a baseline and a %s-hour worklog', async (hoursInput, expectedHours) => {
    act(() => {
      renderPage();
    });
    expect(container.textContent).toContain('Plan migration');
    expect(container.textContent).toContain('1200');
    expect(container.textContent).toContain('Timeline');

    const baselineInput = container.querySelector(
      'input[aria-label="Baseline name"]',
    );
    if (!(baselineInput instanceof HTMLInputElement)) {
      throw new Error('Baseline input was not rendered');
    }
    await act(async () => {
      setControlValue(baselineInput, 'Before launch');
      await Promise.resolve();
    });
    const createButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Create'));
    if (!createButton) throw new Error('Create baseline button was not rendered');
    await act(async () => {
      createButton.click();
      await Promise.resolve();
    });
    expect(mocks.createBaseline).toHaveBeenCalledWith({
      baseline: { name: 'Before launch', schedule_revision: 3 },
      projectId: 'default',
    });

    const task = container.querySelector('select[aria-label="Work log task"]');
    const date = container.querySelector('input[aria-label="Work log date"]');
    const hours = container.querySelector('input[aria-label="Work log hours"]');
    if (!(task instanceof HTMLSelectElement)
      || !(date instanceof HTMLInputElement)
      || !(hours instanceof HTMLInputElement)) {
      throw new Error('Worklog controls were not rendered');
    }
    await act(async () => {
      setControlValue(task, 'task-1');
      setControlValue(date, '2026-08-29');
      setControlValue(hours, hoursInput);
      await Promise.resolve();
    });
    const addWorklog = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Add work log'));
    if (!addWorklog) throw new Error('Add worklog button was not rendered');
    await act(async () => {
      addWorklog.click();
      await Promise.resolve();
    });
    expect(mocks.createWorklog).toHaveBeenCalledWith({
      date: '2026-08-29',
      hours: expectedHours,
      task_id: 'task-1',
    });
  });

  it('generates and applies a leveling proposal with concurrency metadata', async () => {
    act(() => {
      renderPage();
    });
    const generate = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Generate proposal'));
    if (!generate) throw new Error('Proposal button was not rendered');
    await act(async () => {
      generate.click();
      await Promise.resolve();
    });
    expect(mocks.createProposal).toHaveBeenCalledWith('default');

    const apply = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Apply proposal'));
    if (!apply) throw new Error('Apply proposal button was not rendered');
    await act(async () => {
      apply.click();
      await Promise.resolve();
    });
    expect(mocks.applyProposal).toHaveBeenCalledWith({
      proposal: {
        etags: { 'task-1': 'etag-1' },
        schedule_revision: 3,
      },
      proposalId: 'proposal-1',
    });
  });

  it('waits for compact project references before reading a configured project', async () => {
    mocks.pluginSettings.mockReturnValue({ project_table_id: 'projects-table' });
    let resolveProjects!: (pages: { id: string; title: string }[]) => void;
    mocks.projectReferences.mockReturnValue(new Promise((resolve) => { resolveProjects = resolve; }));
    await act(async () => {
      renderPage();
      await Promise.resolve();
    });
    expect(mocks.projectQuery).toHaveBeenLastCalledWith('default', false);
    expect(mocks.baselinesQuery).toHaveBeenLastCalledWith('default', false);
    expect(mocks.allocationQuery).toHaveBeenLastCalledWith('default', false);
    expect(mocks.worklogsQuery).toHaveBeenLastCalledWith('default', false);
    expect(mocks.projectReferences).toHaveBeenCalledWith(
      'projects-table', { include_templates: false }, expect.any(AbortSignal),
    );
    await act(async () => {
      resolveProjects([{ id: 'project-1', title: 'Project one' }]);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    expect(mocks.projectQuery).toHaveBeenLastCalledWith('project-1', true);
    expect(mocks.baselinesQuery).toHaveBeenLastCalledWith('project-1', true);
    expect(mocks.allocationQuery).toHaveBeenLastCalledWith('project-1', true);
    expect(mocks.worklogsQuery).toHaveBeenLastCalledWith('project-1', true);
    const selector = container.querySelector('select[aria-label="Project"]');
    expect(selector).toHaveProperty('disabled', false);
    expect(selector).toHaveProperty('value', 'project-1');
    expect(mocks.projectQuery.mock.calls).not.toContainEqual(['default', true]);
  });

  it('drops drafts and an in-flight proposal when the selected project changes', async () => {
    mocks.pluginSettings.mockReturnValue({ project_table_id: 'projects-table' });
    mocks.projectReferences.mockResolvedValue([
      { id: 'project-a', title: 'Alpha' }, { id: 'project-b', title: 'Beta' },
    ]);
    let resolveProposal!: (value: unknown) => void;
    mocks.createProposal.mockReturnValue(new Promise((resolve) => { resolveProposal = resolve; }));
    await act(async () => { renderPage(); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    const baseline = container.querySelector('input[aria-label="Baseline name"]');
    const selector = container.querySelector('select[aria-label="Project"]');
    const generate = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Generate proposal'));
    if (!(baseline instanceof HTMLInputElement) || !(selector instanceof HTMLSelectElement) || !generate) throw new Error('Planning controls missing');
    await act(async () => { setControlValue(baseline, 'Alpha baseline'); generate.click(); await Promise.resolve(); });
    expect(mocks.createProposal).toHaveBeenCalledWith('project-a');
    await act(async () => { setControlValue(selector, 'project-b'); await Promise.resolve(); });
    expect(mocks.allocationQuery).toHaveBeenLastCalledWith('project-b', true);
    expect(mocks.worklogsQuery).toHaveBeenLastCalledWith('project-b', true);
    expect(container.querySelector('input[aria-label="Baseline name"]')).toHaveProperty('value', '');
    await act(async () => {
      resolveProposal({ id: 'proposal-a', projectId: 'project-a', proposals: [{}], scheduleRevision: 1, sourceEtags: {} });
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain('Apply proposal');
    expect(mocks.applyProposal).not.toHaveBeenCalled();
  });

  it('shows mutation errors without losing the baseline draft', async () => {
    mocks.createBaseline.mockRejectedValue(new Error('Stale revision'));
    act(() => { renderPage(); });
    const baseline = container.querySelector('input[aria-label="Baseline name"]');
    if (!(baseline instanceof HTMLInputElement)) throw new Error('Baseline input missing');
    act(() => { setControlValue(baseline, 'Keep this draft'); });
    const create = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Create'));
    await act(async () => { create?.click(); await Promise.resolve(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Could not create the baseline.');
    expect(baseline.value).toBe('Keep this draft');
  });

});
