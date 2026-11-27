import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SkillAuditsPanel } from './SkillAuditsPanel';
import { deleteSkillAuditSuite, fetchSkillAuditSuites, runSkillAuditSuite, type SkillAuditSuite } from '../../../shared/api/skill-audits';

vi.mock('../../../shared/api/skill-audits', () => ({
  fetchSkillAuditSuites: vi.fn(),
  runSkillAuditSuite: vi.fn(),
  deleteSkillAuditSuite: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const suite: SkillAuditSuite = {
  suite_id: 's1',
  name: 'Weekly summary check',
  agent_id: 'writer',
  skill_id: 'writing.summary',
  interval_days: 7,
  enabled: true,
  cases: [{ id: 'c1', prompt: 'Summarize', expected_substrings: ['ok'], forbidden_substrings: [] }],
  next_run_at: 200,
  last_run_at: 100,
  last_status: 'passed',
  created_at: 50,
  updated_at: 100,
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(fetchSkillAuditSuites).mockResolvedValue([suite]);
  vi.mocked(runSkillAuditSuite).mockResolvedValue({
    run_id: 'r2', suite_id: 's1', skill_id: 'writing.summary', status: 'regressed',
    passed_count: 0, total_count: 1, regressed_case_ids: ['c1'], outcomes: [], created_at: 300,
  });
  vi.mocked(deleteSkillAuditSuite).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => { await Promise.resolve(); root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

it('renders audit suites and triggers an audit run', async () => {
  await act(async () => {
    root.render(<SkillAuditsPanel />);
    await Promise.resolve();
  });
  expect(container.textContent).toContain('Weekly summary check');
  const runBtn = Array.from(container.querySelectorAll('button')).find(btn => btn.textContent === 'skill_audits.run_now');
  expect(runBtn).toBeTruthy();
  await act(async () => {
    runBtn?.click();
    await Promise.resolve();
  });
  expect(runSkillAuditSuite).toHaveBeenCalledWith('s1');
  expect(container.textContent).toContain('skill_audits.status.regressed');
});
