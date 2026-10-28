import { lazy, Suspense, useState } from 'react';
import { DocumentPane } from './DocumentPane';
import type { DashboardController } from './useDashboardController';

const TablePane = lazy(() => import('./TablePane').then(module => ({ default: module.TablePane })));

/** Opening a record hides its originating table without discarding navigation. */
export function InlineTablePane({ dashboard }: { readonly dashboard: DashboardController }) {
  const visibleId = dashboard.viewMode === 'table' ? dashboard.activeTableId : null;
  const [retainedId, setRetainedId] = useState(visibleId);
  if (visibleId && visibleId !== retainedId) setRetainedId(visibleId);
  const tableId = visibleId || retainedId;
  if (!tableId) return null;
  return <DocumentPane key={tableId} paneId={`inline:${tableId}`} visible={Boolean(visibleId)} active={Boolean(visibleId)} style={{ width: '100%' }}>
    <Suspense fallback={<div role="status">{dashboard.t('common.loading')}</div>}>
      <TablePane dashboard={dashboard} tableId={tableId} mode="inline" />
    </Suspense>
  </DocumentPane>;
}
