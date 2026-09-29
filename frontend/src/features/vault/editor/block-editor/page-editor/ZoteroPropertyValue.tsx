import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openVaultResource } from '../../../../../shared/api/vaults';
import { notifyError } from '../../../../../shared/notifications/notifyError';
import { parseVaultResourceValue } from '../../../../../shared/resources/parseVaultResourceValue';
import { propertyDisplayText } from './propertyModel';

export function ZoteroPropertyValue({ value, fieldName, editable, onChange }: {
  value: unknown; fieldName: string; editable: boolean; onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const payload = parseVaultResourceValue(value);
  const open = async () => {
    if (!payload) return;
    try { await openVaultResource(payload); }
    catch (error) { notifyError('open-zotero-property', error, t('table.zotero_open_error')); }
  };
  return <div className="flex items-center gap-1 w-full min-w-0">
    {editable && <input aria-label={fieldName} value={propertyDisplayText(value)} onChange={event => { onChange(event.target.value); }} placeholder={t('common.empty')} className="flex-1 min-w-0 bg-transparent rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:bg-[var(--bg-secondary)]" />}
    {payload ? <button type="button" onClick={() => { void open(); }} title={propertyDisplayText(value)} className="inline-flex items-center gap-1 px-2 py-1 text-sm text-[var(--gnosi-primary)] rounded-lg hover:bg-[var(--bg-secondary)]">
      <ExternalLink size={14} />{t('table.open_zotero')}
    </button> : !editable && <span className="px-2 text-sm text-[var(--text-tertiary)]">{t('common.empty')}</span>}
  </div>;
}
