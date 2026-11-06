import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTablePlugins } from './useTablePlugins';
import { RowActions } from './RowActions';
import { PageActionsBar } from '../../editor/PageActionsBar';
import { useOpenRecordActions } from '../../dashboard/useOpenRecordActions';
import type { DashboardActions } from '../../dashboard/useDashboardActions';
import type { TableController } from './useTableController';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }) }));
vi.mock('../../../../shared/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => { cleanup(); }); });
function render(node: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); act(() => { root.render(node); });
  cleanups.push(() => { act(() => { root.unmount(); }); host.remove(); });
  return host;
}
function model(list = false) {
  return { isListView: list, isSelected: () => false, onNoteSelect: vi.fn(), selectedIds: new Set(), toggleSelect: vi.fn(), t: (key: string, fallback?: string) => fallback || key,
    hasOpenableResource: () => false, openingResourceId: null, tableFunctionalities: [{ id: 'action', action: 'set_fields', label: 'Mark reviewed', enabled: true, config: { assignments: [{ field: 'Status', value: 'Reviewed' }] } }], schema: {}, actionRules: null, executingButtonKey: null, executeTableFunctionality: vi.fn(), setPendingAction: vi.fn(), isLlmWikiTable: false, llmWikiJobs: {}, llmWikiTableId: 'table-a', llmWikiConfig: null, i18n: { language: 'ca' }, onDeletePage: vi.fn(), navRowIndexById: new Map(), isPluginEnabled: () => true } as unknown as TableController;
}
describe('compact record action menus', () => {
  it.each([false, true])('keeps plugin actions in overflow and works in list=%s', list => {
    const controller = model(list);
    const host = render(<table><tbody><tr><RowActions model={controller} note={{ id: 'record' }} isChild={false} /></tr></tbody></table>);
    expect(host.querySelectorAll('button')).toHaveLength(3);
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    act(() => { (host.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement).click(); });
    const item = document.querySelector('[role="menuitem"]') as HTMLButtonElement;
    expect(item.textContent).toContain('Mark reviewed');
    act(() => { item.click(); });
    expect(controller.executeTableFunctionality).toHaveBeenCalledWith(null, { id: 'record' }, expect.objectContaining({ id: 'action' }));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
  it('uses the open record table even when a different table is selected', () => {
    const pages = [{ id: 'record-a', title: 'A', metadata: { table_id: 'table-a' } }, { id: 'record-b', title: 'B', metadata: { table_id: 'table-b' } }];
    const context = { activeTableId: 'table-b', pages, registry: { tables: [{ id: 'table-a', functionalities: [{ id: 'a', action: 'publish_social', label: 'Publish A' }] }, { id: 'table-b', functionalities: [{ id: 'b', action: 'translate_row', label: 'Translate B' }] }] }, getSchemaFromTableId: () => ({}), resolvePageTableId: (page: typeof pages[number]) => page.metadata.table_id, isPluginEnabled: () => true, llmWikiConfig: null, llmWikiJobs: {}, setLlmWikiJobs: vi.fn(), refreshTableAfterTranslate: vi.fn(), t: (key: string, fallback?: string) => fallback || key, i18n: { language: 'ca' } } as unknown as DashboardActions;
    let pending: unknown;
    let translated: ((data: unknown) => void) | undefined;
    function RecordPage() {
      const actions = useOpenRecordActions(context, pages[0], 'table-a', true);
      pending = actions.recordActionDialogs.pendingAction;
      translated = actions.recordActionDialogs.onTranslated;
      return <PageActionsBar pageActions={{ recordActions: actions.recordActions }} />;
    }
    const host = render(<RecordPage />);
    act(() => { (host.querySelector('button') as HTMLButtonElement).click(); });
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain('Publish A');
    expect(menu?.textContent).not.toContain('Translate B');
    act(() => { (menu?.querySelector('button') as HTMLButtonElement).click(); });
    expect(pending).toMatchObject({ noteId: 'record-a', action: 'publish_social' });
    const result = { created: [{ id: 'translated-page' }] };
    translated?.(result);
    expect(context.refreshTableAfterTranslate).toHaveBeenCalledWith('table-a', result);
  });
  it.each(['resolved_table_id', 'table_id', 'database_table_id'])('finds processing source from %s', key => {
    let configured = false;
    function Harness() {
      const note = key === 'resolved_table_id' ? { id: 'record', resolved_table_id: 'source' } : { id: 'record', metadata: { [key]: 'source' } };
      const result = useTablePlugins({ schema: {}, notes: [note], functionalities: [], isPluginEnabled: () => true,
        llmWikiConfig: { agent_id: 'agent', brain_table_id: 'brain', configured: true, target_table: 'brain', source_tables: [{ table_id: 'source' }], processed_resources: {} } });
      configured = result.isLlmWikiTable;
      return null;
    }
    render(<Harness />);
    expect(configured).toBe(true);
  });

});
