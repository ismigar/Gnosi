import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WatchdogAlertsPanel } from './WatchdogAlertsPanel';
import { dismissWatchdogAlert, fetchWatchdogAlerts, runWatchdogSweep, type WatchdogAlert } from '../../../shared/api/watchdog';

vi.mock('../../../shared/api/watchdog', () => ({
  fetchWatchdogAlerts: vi.fn(),
  runWatchdogSweep: vi.fn(),
  dismissWatchdogAlert: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const alertItem: WatchdogAlert = {
  alert_id: 'a1',
  run_id: 'r1',
  agent_id: 'writer',
  operation: 'podcast',
  kind: 'transient_failure',
  status: 'open',
  suggested_action: 'resume',
  summary: 'Transient provider failure: 429 rate limit',
  retry_count: 0,
  last_retry_at: null,
  created_at: 100,
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
  vi.mocked(fetchWatchdogAlerts).mockResolvedValue([alertItem]);
  vi.mocked(runWatchdogSweep).mockResolvedValue({ scanned_runs: 1, new_alerts: 0, auto_retried: 0, open_alerts: [alertItem] });
  vi.mocked(dismissWatchdogAlert).mockResolvedValue({ ...alertItem, status: 'dismissed' });
});

afterEach(async () => {
  await act(async () => { await Promise.resolve(); root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

it('renders watchdog alerts and dismisses an alert', async () => {
  await act(async () => {
    root.render(<WatchdogAlertsPanel />);
    await Promise.resolve();
  });
  expect(container.textContent).toContain('Transient provider failure');
  const dismissBtn = Array.from(container.querySelectorAll('button')).find(btn => btn.textContent === 'watchdog.dismiss');
  expect(dismissBtn).toBeTruthy();
  await act(async () => {
    dismissBtn?.click();
    await Promise.resolve();
  });
  expect(dismissWatchdogAlert).toHaveBeenCalledWith('a1');
  expect(container.textContent).toContain('watchdog.empty');
});
