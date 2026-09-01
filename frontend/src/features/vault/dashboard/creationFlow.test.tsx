import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vault from '../../../shared/api/vaults';
import * as views from '../../../shared/api/vault-views';
import { fetchBrainTableStatus } from '../../../shared/api/brain';
import { fetchReferenceTable } from '../../../shared/api/literature-resources';
import { toast } from '../../../shared/notifications/toast';
import { DashboardContent } from './DashboardContent';
import { DashboardSidebar } from './DashboardSidebar';
import { ConfirmationDialogs } from './ConfirmationDialogs';
import { renderController } from './__tests__/controller-support';
import { installApiDefaults } from './test-support';

vi.mock('../../../shared/api/vaults');
vi.mock('../../../shared/api/vault-views');
vi.mock('../../../shared/api/brain');
vi.mock('../../../shared/api/literature-resources');
vi.mock('../../../shared/api/resource-processing');
vi.mock('../../../shared/notifications/toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('../../../shared/api/use-api', () => ({ useApi: () => ({ role: 'admin' }) }));
vi.mock('../../../shared/hooks/useActiveVaultName', () => ({ useActiveVaultName: () => 'Synthetic Vault' }));
// Keep both creation controls, their prompt and controller real; unrelated
// editor/rendering surfaces do not participate in the creation contract.
vi.mock('./EditorPane', () => ({ EditorPane: () => null }));
vi.mock('./TablePane', () => ({ TablePane: () => null }));
vi.mock('../navigation/VaultDocumentTabs', () => ({ VaultDocumentTabs: () => null }));
vi.mock('../drawings/VaultDrawings', () => ({ default: () => null }));
vi.mock('../navigation/VaultTrashView', () => ({ VaultTrashView: () => null }));
vi.mock('../navigation/VaultTagsView', () => ({ VaultTagsView: () => null }));

let harness: Awaited<ReturnType<typeof renderController>>;
let dispose: (() => Promise<void>) | undefined;
beforeEach(async () => {
  vi.clearAllMocks();
  dispose = undefined;
  vi.stubGlobal('matchMedia', (): Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'> => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  installApiDefaults();
  vi.mocked(vault.createVaultDatabase).mockReset().mockResolvedValue({ id: 'created-db', name: 'Research' });
  vi.mocked(vault.createVaultTable).mockReset().mockResolvedValue({ id: 'created-table', name: 'Records', database_id: 'db' });
  vi.mocked(fetchBrainTableStatus).mockRejectedValue(new Error('disabled fixture'));
  vi.mocked(fetchReferenceTable).mockRejectedValue(new Error('disabled fixture'));
  harness = await renderController('', controller => <>
    <DashboardContent {...controller} />
    <DashboardSidebar {...controller} />
    <ConfirmationDialogs {...controller} />
  </>);
  dispose = () => harness.unmount();
});
afterEach(async () => { await dispose?.(); vi.unstubAllGlobals(); });

function button(label: string): HTMLButtonElement {
  const result = [...harness.container.querySelectorAll('button')].find(
    candidate => candidate.getAttribute('aria-label') === label || candidate.textContent.trim() === label,
  );
  if (!result) throw new Error(`Missing synthetic control: ${label}`);
  return result;
}

async function click(label: string): Promise<void> {
  await act(async () => { button(label).click(); await Promise.resolve(); });
}

async function name(value: string): Promise<void> {
  const input = harness.container.querySelector('form input');
  if (!(input instanceof HTMLInputElement)) throw new Error('Missing name input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function submit(): Promise<void> {
  const form = harness.container.querySelector('form');
  if (!form) throw new Error('Missing creation form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

describe.each(['Create a DB', 'sidebar.add_database'])('database group via %s', entry => {
  it('opens the group prompt and writes only the registry database endpoint', async () => {
    await click(entry);
    expect(harness.container.querySelector('h3')?.textContent).toBe('common.new_app');
    await name('  Research  ');
    await submit();
    expect(vault.createVaultDatabase).toHaveBeenCalledExactlyOnceWith({ name: 'Research' });
    expect(vault.createVaultPage).not.toHaveBeenCalled();
    expect(vault.createVaultTable).not.toHaveBeenCalled();
    expect(views.createVaultView).not.toHaveBeenCalled();
    expect(vault.fetchVaultRegistry).toHaveBeenCalledTimes(2);
    expect(vault.fetchVaultPages).toHaveBeenCalledTimes(1);
    expect(harness.current.promptModal.isOpen).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('success.app_created');
  });

  it('cancels without writing and does not leak group intent into a new page', async () => {
    await click(entry);
    await name('Cancelled group');
    await click('common.cancel');
    expect(vault.createVaultDatabase).not.toHaveBeenCalled();
    await click('Create a page');
    await name('Page after cancel');
    await submit();
    expect(vault.createVaultPage).toHaveBeenCalledExactlyOnceWith({
      title: 'Page after cancel', content: '', parent_id: null, is_database: false, metadata: undefined,
    });
    expect(vault.createVaultDatabase).not.toHaveBeenCalled();
  });

  it('rejects whitespace names without creating a page or group', async () => {
    await click(entry);
    await name('   ');
    expect(button('common.create').disabled).toBe(true);
    await harness.run(controller => controller.executeCreateContent());
    expect(vault.createVaultDatabase).not.toHaveBeenCalled();
    expect(vault.createVaultPage).not.toHaveBeenCalled();
    expect(harness.current.promptModal.isOpen).toBe(false);
  });

  it('keeps the group name and intent on failure, then retries the same endpoint', async () => {
    vi.mocked(vault.createVaultDatabase).mockRejectedValueOnce(new Error('synthetic unavailable'));
    await click(entry);
    await name('Retry group');
    await submit();
    expect(harness.current.promptModal).toMatchObject({ isOpen: true, isLoading: false, isApp: true, inputValue: 'Retry group' });
    expect(toast.error).toHaveBeenCalledWith('errors.create_content');
    expect(vault.fetchVaultRegistry).toHaveBeenCalledTimes(1);
    await submit();
    expect(vault.createVaultDatabase).toHaveBeenCalledTimes(2);
    expect(vault.createVaultDatabase).toHaveBeenLastCalledWith({ name: 'Retry group' });
    expect(vault.createVaultPage).not.toHaveBeenCalled();
    expect(harness.current.promptModal.isOpen).toBe(false);
  });
});

describe('distinct existing creation contracts', () => {
  it('still creates a table and main view inside its selected group', async () => {
    await click('Data');
    await click('sidebar.new_table');
    expect(harness.container.querySelector('h3')?.textContent).toBe('common.new_table');
    await name('Records');
    await submit();
    expect(vault.createVaultTable).toHaveBeenCalledExactlyOnceWith({
      name: 'Records', database_id: 'db', locale: 'en', properties: [{ name: 'Status', type: 'select' }],
    });
    expect(views.createVaultView).toHaveBeenCalledWith(expect.objectContaining({ table_id: 'created-table' }));
    expect(vault.createVaultDatabase).not.toHaveBeenCalled();
    expect(vault.createVaultPage).not.toHaveBeenCalled();
  });

  it('preserves explicit legacy database-page creation for existing callers', async () => {
    await harness.run(controller => { controller.handleOpenCreatePrompt(null, true); });
    await name('Legacy database page');
    await submit();
    expect(vault.createVaultPage).toHaveBeenCalledExactlyOnceWith({
      title: 'Legacy database page', content: '', parent_id: null, is_database: true, metadata: undefined,
    });
    expect(vault.createVaultDatabase).not.toHaveBeenCalled();
  });
});
