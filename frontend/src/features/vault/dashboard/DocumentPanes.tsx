import { lazy, Suspense, useState } from 'react';
import { DocumentPane } from './DocumentPane';
import type { DashboardController } from './useDashboardController';

const EditorPane = lazy(() => import('./EditorPane').then(module => ({ default: module.EditorPane })));
const TablePane = lazy(() => import('./TablePane').then(module => ({ default: module.TablePane })));

export function DocumentPanes({ dashboard }: { readonly dashboard: DashboardController }) {
  const { activeTabId, openPaneEntries, paneSizes, splitTableIds, tabs, viewMode, handleDividerMouseDown, t } = dashboard;
  const tabIds = new Set(tabs.filter(tab => !tab.isDrawing).map(tab => tab.id));
  const paneKey = (pane: { id: string }) => `${tabIds.has(pane.id) ? 'tab' : 'table'}:${pane.id}`;
  const visible = viewMode === 'editor' && activeTabId
    ? [...new Map(openPaneEntries.map(pane => [paneKey(pane), pane])).entries()]
    : [];
  const opened = new Set([...tabIds].map(id => `tab:${id}`).concat(splitTableIds.map(id => `table:${id}`)));
  const [retained, setRetained] = useState<string[]>([]);
  const next = [...new Set([...retained.filter(key => opened.has(key)), ...visible.map(([key]) => key)])];
  // Only visit a tab once it is shown, and release its editor when it closes.
  // Adjusting this component's state during render keeps the same keyed child
  // in the very commit that switches tabs (no effect-driven unmount/remount).
  if (next.length !== retained.length || next.some((key, index) => key !== retained[index])) setRetained(next);

  return <>
    {next.map(key => {
      const index = visible.findIndex(([visibleKey]) => visibleKey === key);
      const id = key.slice(key.indexOf(':') + 1);
      return <DocumentPane
        key={key}
        paneId={key}
        visible={index >= 0}
        active={index >= 0 && id === activeTabId}
        style={{ order: index * 2, width: `${String(paneSizes[index] ?? 100 / Math.max(visible.length, 1))}%` }}
      >
        <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-[var(--text-secondary)] animate-pulse">{t('common.loading')}</div>}>
          {key.startsWith('tab:')
            ? <EditorPane dashboard={dashboard} tabId={id} />
            : <TablePane dashboard={dashboard} tableId={id} mode="split" />}
        </Suspense>
      </DocumentPane>;
    })}
    {visible.slice(0, -1).map(([key], index) => <div
      key={`divider:${key}`}
      style={{ order: index * 2 + 1 }}
      className="w-1 shrink-0 bg-[var(--border-primary)] hover:bg-indigo-300 cursor-col-resize transition-colors active:bg-indigo-400 z-10 select-none"
      onMouseDown={event => { handleDividerMouseDown(index, event); }}
      title={t('common.drag_resize')}
    />)}
  </>;
}
