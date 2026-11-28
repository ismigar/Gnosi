import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkflowChainsPanel } from './WorkflowChainsPanel';
import { cancelWorkflowChain, fetchWorkflowChains, runWorkflowChain, type WorkflowChainRun } from '../../../shared/api/workflow-chains';

vi.mock('../../../shared/api/workflow-chains', () => ({
  fetchWorkflowChains: vi.fn(),
  runWorkflowChain: vi.fn(),
  cancelWorkflowChain: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const sampleChain: WorkflowChainRun = {
  chain_id: 'c1',
  name: 'Nightly review',
  status: 'failed',
  current_step_index: 1,
  created_at: 100,
  updated_at: 200,
  steps: [
    { step_id: 's1', name: 'Extract', agent_id: 'a1', skill_id: 'sk1', instruction: 'i1', max_model_calls: 4, timeout_seconds: 180, status: 'completed', run_id: 'r1', output_text: 'ok', error: '', started_at: 100, completed_at: 110 },
    { step_id: 's2', name: 'Review', agent_id: 'a2', skill_id: 'sk2', instruction: 'i2', max_model_calls: 4, timeout_seconds: 180, status: 'failed', run_id: '', output_text: '', error: 'timeout', started_at: 110, completed_at: 120 },
  ],
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(fetchWorkflowChains).mockResolvedValue([sampleChain]);
  vi.mocked(runWorkflowChain).mockResolvedValue({ ...sampleChain, status: 'completed' });
  vi.mocked(cancelWorkflowChain).mockResolvedValue({ ...sampleChain, status: 'cancelled' });
});

afterEach(async () => {
  await act(async () => { await Promise.resolve(); root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

it('renders persisted workflow chains and resumes a failed chain', async () => {
  await act(async () => {
    root.render(<WorkflowChainsPanel />);
    await Promise.resolve();
  });
  expect(container.textContent).toContain('Nightly review');
  expect(container.textContent).toContain('timeout');
  const resumeBtn = Array.from(container.querySelectorAll('button')).find(btn => btn.textContent === 'workflow_chains.resume');
  expect(resumeBtn).toBeTruthy();
  await act(async () => {
    resumeBtn?.click();
    await Promise.resolve();
  });
  expect(runWorkflowChain).toHaveBeenCalledWith('c1');
});
