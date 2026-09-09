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
  usePlanningAllocation: () => ({
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
  }),
  usePlanningBaselines: (projectId: string, enabled: boolean) => {
    mocks.baselinesQuery(projectId, enabled);
    return {
    data: { baselines: [] },
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
    };
  },
  usePlanningWorklogs: () => ({
    data: { worklogs: [] },
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
  }),
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
  it('renders the typed schedule and creates a baseline and worklog', async () => {
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
      setControlValue(hours, '2.5');
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
      hours: 2.5,
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
    const selector = container.querySelector('select[aria-label="Project"]');
    expect(selector).toHaveProperty('disabled', false);
    expect(selector).toHaveProperty('value', 'project-1');
    expect(mocks.projectQuery.mock.calls).not.toContainEqual(['default', true]);
  });
});
