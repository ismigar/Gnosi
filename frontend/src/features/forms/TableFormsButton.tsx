import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList } from 'lucide-react';
import { usePlugins } from '../../shared/plugins/usePlugins';

const FormsManager = lazy(() => import('./FormsManager'));

export function TableFormsButton({ tableId, tableName }: { tableId: string; tableName: string }) {
  const { t } = useTranslation();
  const { isEnabled } = usePlugins();
  const [open, setOpen] = useState(false);
  if (!isEnabled('share-links')) return null;
  return <>
    <div className="flex justify-end border-b border-[var(--border-primary)] px-3 py-1">
      <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]" onClick={() => { setOpen(true); }}>
        <ClipboardList size={14} />{t('forms.manage', 'Public forms')}
      </button>
    </div>
    {open && <Suspense fallback={null}><FormsManager tableId={tableId} tableName={tableName} onClose={() => { setOpen(false); }} /></Suspense>}
  </>;
}
