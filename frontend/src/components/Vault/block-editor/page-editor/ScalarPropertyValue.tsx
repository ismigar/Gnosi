import { ImageHoverPreview } from '../../ImageHoverPreview';
import { VaultDateProperty } from '../../VaultDateProperty';
import { formatDate } from '../../formatUtils';
import { formatNumber } from '../../formatUtils';
import { isImageFieldName } from '../../../../lib/fileResource';
import { parseImageField } from '../../../../lib/fileResource';
import { resolveFieldFormat } from '../../formatUtils';
import { resolveSystemDateValue } from '../../schemaUtils';
import { toAssetPreviewUrl } from '../../../../lib/fileResource';
import type { PageEditorController } from './usePageEditorController';
import type { PageProperty } from './types';
import { dateValue, inputValue, legacyText, periodInput, planningNotes, planningSettings } from './valueBoundaries';
export function ScalarPropertyValue({ context, prop }: { context: PageEditorController; prop: PageProperty }) {
  const { metadata, isEditor, setImagePickerProp, t, localeSettings, getPropConfig, noteFilename, allNotes, idToTitle, projectPlanningSettings, projectPlanningEnabled, handleMetaChange } = context;

  const v = metadata[prop.name];
  const hasVal = v !== undefined && v !== null && v !== '';
  // Image field inferred by NAME (same detection as the table
  // cell, via isImageFieldName) for text fields: if the value
  // resolves to a servable image, it is shown as a thumbnail with
  // preview on hover; in edit mode, clicking opens the picker
  // (parity with the table) and, if empty, a "+ Image" affordance.
  // "Image Alt Text" is excluded (it's prose) and remains text.
  // Explicit `image` type: always thumbnail/picker, whatever the name.
  if (prop.type === 'image' || ((!prop.type || prop.type === 'text') && isImageFieldName(prop.name))) {
    const imgMeta = parseImageField(v);
    const previewUrl = toAssetPreviewUrl(imgMeta.src);
    const imgAlt = imgMeta.alt || prop.name;
    if (previewUrl) {
      if (!isEditor) return <ImageHoverPreview src={previewUrl} alt={imgAlt} />;
      return (
        <button
          type="button"
          onClick={() => { setImagePickerProp(prop.name); }}
          title={t('table.change_image', { defaultValue: "Change image" })}
          className="inline-flex items-center rounded hover:opacity-90 focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]/40"
        >
          <ImageHoverPreview src={previewUrl} alt={imgAlt} />
        </button>
      );
    }
    if (isEditor) {
      return (
        <button
          type="button"
          onClick={() => { setImagePickerProp(prop.name); }}
          className="text-sm italic text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] px-2 py-1 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors text-left"
        >
          {t('table.add_image', { defaultValue: "+ Image" })}
        </button>
      );
    }
    return <span className="text-sm text-[var(--text-tertiary)]">{t('common.empty')}</span>;
  }
  // System timestamps are read-only audit fields. They are stored as
  // ISO values but must use the same display formatting as ordinary
  // date fields on every page.
  if (prop.type === 'created_time' || prop.type === 'last_edited_time') {
    const systemValue = resolveSystemDateValue(
      { metadata, created_time: metadata.created_time, last_modified: metadata.last_modified },
      {},
      prop.type,
      prop.name,
    ) || v;
    const pfmt = resolveFieldFormat({ format: prop.config?.format || prop.format }, localeSettings);
    return (
      <span className="px-2 py-1 text-sm text-[var(--text-primary)] font-medium tabular-nums">
        {systemValue ? formatDate(dateValue(systemValue), { dateFormat: pfmt.dateFormat, type: 'datetime', locale: pfmt.dateLocale }) : '—'}
      </span>
    );
  }
  // Read mode: formatted number/date (global or field override).
  if (!isEditor && hasVal && (prop.type === 'number' || prop.type === 'date' || prop.type === 'datetime')) {
    const pfmt = resolveFieldFormat({ format: prop.config?.format || prop.format }, localeSettings);
    const text = prop.type === 'number'
      ? formatNumber(v, { kind: pfmt.kind, decimals: pfmt.decimals, currencyCode: pfmt.currencyCode, locale: pfmt.numberLocale })
      : formatDate(dateValue(v), { dateFormat: pfmt.dateFormat, type: prop.type === 'datetime' ? 'datetime' : 'date', locale: pfmt.dateLocale });
    return <span className="px-2 py-1 text-sm text-[var(--text-primary)] font-medium tabular-nums">{text}</span>;
  }
  if (prop.type === 'date' || prop.type === 'datetime' || prop.type === 'period') {
    return (
      <div className={`w-full flex items-center group/date ${prop.type === 'period' ? 'min-h-7' : 'h-7'}`}>
        <VaultDateProperty
          value={periodInput(v || "")}
          rruleValue={legacyText(metadata[`${prop.name}_rrule`] || '')}
          type={prop.type}
          fieldConfig={getPropConfig(prop)}
          fieldName={prop.name}
          noteId={noteFilename}
          notes={planningNotes(allNotes)}
          idToTitle={idToTitle}
          planningSettings={planningSettings(projectPlanningSettings)}
          planningEnabled={projectPlanningEnabled}
          onChange={val => { handleMetaChange(prop.name, val); }}
          onRruleChange={rrule => { handleMetaChange(`${prop.name}_rrule`, rrule); }}
        />
      </div>
    );
  }
  return <input disabled={!isEditor} type={prop.type === 'number' ? 'number' : 'text'} value={inputValue(v)} onChange={e => { handleMetaChange(prop.name, e.target.value); }} placeholder={t('common.empty')} className="w-full bg-transparent border-none rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] transition-all placeholder:[var(--text-tertiary)]/20 font-medium h-7 disabled:cursor-not-allowed" />;

}
