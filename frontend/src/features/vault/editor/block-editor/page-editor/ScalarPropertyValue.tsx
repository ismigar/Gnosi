import { NumberValue } from '../../../../../shared/records/NumberValue';
import { GnosiToggle } from '../../../../../shared/ui/settings/SettingsPrimitives';
import { asBool } from '../../../../../shared/filtering/vaultFilters';
import { isPagePropertyReadOnly, propertyDisplayText } from './propertyModel';
import { parsePeriod } from '../../../properties/VaultDateProperty';
import { ImageHoverPreview } from '../../../../../shared/ui/previews/ImageHoverPreview';
import { VaultDateProperty } from '../../../properties/VaultDateProperty';
import { formatDate } from '../../../../../shared/records/model/formatUtils';
import { isImageFieldName } from '../../../../../shared/resources/fileResource';
import { parseImageField } from '../../../../../shared/resources/fileResource';
import { resolveFieldFormat } from '../../../../../shared/records/model/formatUtils';
import { resolveSystemDateValue } from '../../../../../shared/records/model/schemaUtils';
import { toAssetPreviewUrl } from '../../../../../shared/resources/fileResource';
import type { PageEditorController } from './usePageEditorController';
import type { PageProperty } from './types';
import { dateValue, inputValue, legacyText, periodInput, planningNotes, planningSettings } from './valueBoundaries';
export function ScalarPropertyValue({ context, prop }: { context: PageEditorController; prop: PageProperty }) {
  const { metadata, setImagePickerProp, t, localeSettings, getPropConfig, noteFilename, allNotes, idToTitle, projectPlanningSettings, projectPlanningEnabled, handleMetaChange, getPropValue } = context;

  const v = getPropValue(prop);
  const isEditor = context.isEditor && !isPagePropertyReadOnly(prop);
  const hasVal = v !== undefined && v !== null && v !== '';
  if (prop.type === 'checkbox') {
    return <GnosiToggle label={prop.name} active={asBool(v)} disabled={!isEditor} onChange={() => { handleMetaChange(prop.name, !asBool(v)); }} />;
  }
  if (['formula', 'rollup', 'virtual', 'created_by', 'last_edited_by', 'button'].includes(prop.type)) {
    if (typeof v === 'boolean') return <GnosiToggle label={prop.name} active={v} disabled />;
    const fmt = resolveFieldFormat(getPropConfig(prop), localeSettings);
    const text = ['formula', 'rollup', 'virtual'].includes(prop.type) && (typeof v === 'number' || typeof v === 'string')
      ? <NumberValue value={v} format={fmt} />
      : propertyDisplayText(v);
    return <span className="px-2 py-1 text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words" aria-label={prop.name}>{text || t('common.empty')}</span>;
  }
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
      { metadata: { ...metadata, [prop.name]: v }, created_time: metadata.created_time, last_modified: metadata.last_modified },
      {},
      prop.type,
      prop.name,
    ) || v;
    const pfmt = resolveFieldFormat(getPropConfig(prop), localeSettings);
    return (
      <span className="px-2 py-1 text-sm text-[var(--text-primary)] font-medium tabular-nums">
        {systemValue ? formatDate(dateValue(systemValue), { dateFormat: pfmt.dateFormat, type: 'datetime', locale: pfmt.dateLocale }) : '—'}
      </span>
    );
  }
  if (!isEditor && (prop.type === 'date' || prop.type === 'datetime' || prop.type === 'period')) {
    const fmt = resolveFieldFormat(getPropConfig(prop), localeSettings);
    const period = parsePeriod(v);
    const formatBoundary = (value: unknown) => formatDate(dateValue(value), { dateFormat: fmt.dateFormat, type: prop.type === 'datetime' || String(value).includes('T') ? 'datetime' : 'date', locale: fmt.dateLocale });
    const text = period.start ? [formatBoundary(period.start), ...(period.end && period.end !== period.start ? [formatBoundary(period.end)] : [])].join(' → ') : '';
    return <span className="px-2 py-1 text-sm text-[var(--text-primary)] tabular-nums" aria-label={prop.name}>{text || t('common.empty')}</span>;
  }
  if (!isEditor && hasVal && prop.type === 'number') {
    const fmt = resolveFieldFormat(getPropConfig(prop), localeSettings);
    return <span className="px-2 py-1 text-sm text-[var(--text-primary)] tabular-nums"><NumberValue value={v} format={fmt} /></span>;
  }
  if (isEditor && prop.type === 'number') {
    const format = resolveFieldFormat(getPropConfig(prop), localeSettings);
    if (format.display === 'bar' || format.display === 'ring') return <div className="flex flex-wrap items-center gap-2"><NumberValue value={v} format={format} /><input aria-label={prop.name} type="number" step="any" value={inputValue(v)} onChange={e => { handleMetaChange(prop.name, e.target.value === '' ? '' : e.target.valueAsNumber); }} className="w-20 rounded bg-[var(--bg-secondary)] px-2 py-1 text-sm" /></div>;
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
  return <input aria-label={prop.name} disabled={!isEditor} type={prop.type === 'number' ? 'number' : 'text'} step={prop.type === 'number' ? 'any' : undefined} value={inputValue(v)} onChange={e => { handleMetaChange(prop.name, prop.type === 'number' && e.target.value !== '' ? e.target.valueAsNumber : e.target.value); }} placeholder={t('common.empty')} className="w-full bg-transparent border-none rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] transition-all placeholder:[var(--text-tertiary)]/20 font-medium h-7 disabled:cursor-not-allowed" />;

}
