import { buildImageValue, fileTargetKey, getImageSrc } from '../../../../shared/resources/fileResource';
import { InsertContentModal } from '../../content/InsertContentModal';
import { getFieldType } from '../../../../shared/records/model/schemaUtils';
import { displayString } from './fieldConfig';
import type { TableController } from './useTableController';

export function TableMediaDialog({ model }: { model: TableController; }) {
  const { schema, mediaPickerCell, setMediaPickerCell, safeNotes, handleCellSave, urlToVaultPath } = model;
  return (<InsertContentModal
    key={mediaPickerCell?.rowId || 'closed'}
    open={Boolean(mediaPickerCell)}
    tableId={mediaPickerCell?.tableId || ''}
    fileField={mediaPickerCell?.fileField || null}
    rowMetadata={mediaPickerCell?.rowMetadata || {}}
    imageField={Boolean(mediaPickerCell?.imageField)}
    initialImageMeta={mediaPickerCell?.imageMeta || null}
    onClose={() => { setMediaPickerCell(null); }}
    onInsert={(result) => {
      if (!mediaPickerCell) return;
      const { rowId, field, originalMetaKey } = mediaPickerCell;
      if (result.metadataOnly) {
        const note = safeNotes.find(n => n.id === rowId);
        const currentSrc = getImageSrc(note?.metadata?.[originalMetaKey]);
        if (currentSrc) {
          void handleCellSave(rowId, field, buildImageValue(currentSrc, result.imageMeta || {}), originalMetaKey);
        }
        setMediaPickerCell(null);
        return;
      }
      if (result.urls && result.urls.length && getFieldType(schema, field) === 'files') {
        const note = safeNotes.find(n => n.id === rowId);
        const existing = note?.metadata?.[originalMetaKey];
        const arr = (Array.isArray(existing) ? existing : (existing ? [existing] : []))
          .map(v => displayString(v ?? '')).filter(v => v.trim() !== '');
        const seen = new Set(arr.map(fileTargetKey));
        const adds = [];
        for (const u of result.urls) {
          const vp = urlToVaultPath(u || '');
          if (!vp) continue;
          const key = fileTargetKey(vp);
          if (seen.has(key)) continue;
          seen.add(key);
          adds.push(vp);
        }
        if (!adds.length) { setMediaPickerCell(null); return; }
        const next = [...arr, ...adds];
        void handleCellSave(rowId, field, next.length === 1 ? next[0] : next, originalMetaKey);
        setMediaPickerCell(null);
        return;
      }
      const newPath = urlToVaultPath(result.url || '');
      let value: unknown = newPath;
      if (newPath && getFieldType(schema, field) === 'files') {
        const note = safeNotes.find(n => n.id === rowId);
        const existing = note?.metadata?.[originalMetaKey];
        const arr = (Array.isArray(existing) ? existing : (existing ? [existing] : []))
          .map(v => displayString(v ?? '')).filter(v => v.trim() !== '');
        const newKey = fileTargetKey(newPath);
        if (arr.some(v => fileTargetKey(v) === newKey)) {
          setMediaPickerCell(null);
          return;
        }
        const next = [...arr, newPath];
        value = next.length === 1 ? next[0] : next;
      } else if (newPath) {
        value = buildImageValue(newPath, result.imageMeta || {});
      }
      void handleCellSave(rowId, field, value, originalMetaKey);
      setMediaPickerCell(null);
    }}
  />);
}
