import { useCallback } from 'react';
import { toast } from '../../../../shared/notifications/toast';
import { transportFetch } from '../../../../shared/api/transports';
import { hasResourceReference } from '../resourceLinkUtils';
import { displayString, isRecord } from './fieldConfig';
import { getMetadataValueByNormalizedKey } from './metadata';
import type { TableNote } from './types';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableIdentity>, 't'>
  & Pick<ReturnType<typeof useTableState>, 'setOpeningResourceId'>;

export function useTableResources({ t, setOpeningResourceId }: Inputs) {
  const hasOpenableResource = useCallback((note: TableNote) => {
    const metadata = note.metadata || {};
    const zoteroUri = displayString(getMetadataValueByNormalizedKey(metadata, ['Zotero uri', 'zotero_uri', 'zotero uri'])).trim();
    const filePath = displayString(getMetadataValueByNormalizedKey(metadata, ["Ruta de l'arxiu", 'ruta_arxiu', 'file_path', 'path'])).trim();
    const attachments = getMetadataValueByNormalizedKey(metadata, ['Adjunts', 'attachments', 'adjuntos']);
    return hasResourceReference(zoteroUri)
      || hasResourceReference(filePath)
      || hasResourceReference(attachments);
  }, []);
  const handleOpenExternalResource = useCallback(async (note: TableNote) => {
    const metadata = note.metadata || {};
    const zoteroUri = displayString(getMetadataValueByNormalizedKey(metadata, ['Zotero uri', 'zotero_uri', 'zotero uri'])).trim();
    const filePath = displayString(getMetadataValueByNormalizedKey(metadata, ["Ruta de l'arxiu", 'ruta_arxiu', 'file_path', 'path'])).trim();
    const attachments = getMetadataValueByNormalizedKey(metadata, ['Adjunts', 'attachments', 'adjuntos']);

    if (!zoteroUri && !filePath && !attachments) {
      toast.error(t('table.no_resource_error'));
      return;
    }

    try {
      setOpeningResourceId(note.id);
      const response = await transportFetch('/api/vault/open-resource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zotero_uri: zoteroUri || null,
          file_path: filePath || null,
          attachments,
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => ({}));
        throw new Error(displayString((isRecord(payload) ? payload.detail : undefined) || t('table.open_resource_error')));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('table.open_resource_error');
      toast.error(message);
    } finally {
      setOpeningResourceId(null);
    }
  }, [setOpeningResourceId, t]);
  return { hasOpenableResource, handleOpenExternalResource };
}
