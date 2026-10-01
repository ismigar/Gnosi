import { isPagePropertyReadOnly, propertyDisplayText } from './propertyModel';
import { ZoteroPropertyValue } from './ZoteroPropertyValue';
import { inputValue, legacyText, arrayValues } from './valueBoundaries';
import { AutoriaDisplay } from '../../../properties/AutoriaField';
import { AutoriaEditor } from '../../../properties/AutoriaField';
import { ExternalLink } from 'lucide-react';
import { FileAttachmentField } from '../../../properties/FileAttachmentField';
import { FileFieldValue } from '../../../properties/FileFieldValue';
import { MultiSelectPills } from '../property-controls/MultiSelectPills';
import { ScalarPropertyValue } from './ScalarPropertyValue';
import { dedupeAuthors } from '../../../properties/autoriaUtils';
import { normalizeOption } from '../../../../../shared/records/model/optionCatalogUtils';
import type { PageEditorController } from './usePageEditorController';
import type { PageProperty } from './types';
import { sourceSectionOptions, sourceSectionTitle } from '../../../properties/sourceSectionRelations';
export function PropertyValue({ context, prop }: { context: PageEditorController; prop: PageProperty }) {
  const { allNotes, metadata, idToTitle, handleMetaChange, t, onOpenInNewTab, onOpenPage, handleRelationRemove, getPropOptions, onAddSchemaOption, currentTableId, rawTableId, getPropValue, getPropConfig } = context;
  const isEditor = context.isEditor && !isPagePropertyReadOnly(prop);
  const value = getPropValue(prop);
  const config = getPropConfig(prop);
  return (prop.type === 'relation' ? (() => {
    const relatedNotes = sourceSectionOptions(allNotes, config, metadata);
    const options = relatedNotes.map(n => n.id);
    const relatedMap = { ...idToTitle, ...Object.fromEntries(relatedNotes.map(n => [n.id, sourceSectionTitle(n, config.source_sections === true)])) };
    return (
      <MultiSelectPills
        single={config.source_sections === true}
        label={prop.name}
        disabled={!isEditor}
        value={value}
        onChange={val => { if (isEditor) handleMetaChange(prop.name,
          config.source_sections === true ? (val ? [val] : []) : val); }}
        options={options}
        idToTitle={relatedMap}
        placeholder={isEditor ? t('editor.add_options') : t('common.empty')}
        relationItems
        onOpenRelation={onOpenInNewTab || onOpenPage}
        onRemoveRelation={isEditor
          ? (relationId) => handleRelationRemove(prop.name, relationId, relatedMap)
          : undefined}
      />
    );
  })() : prop.type === 'multi_select' ? (
    <MultiSelectPills
        label={prop.name}
        disabled={!isEditor}
      value={value}
      onChange={val => { if (isEditor) handleMetaChange(prop.name, val); }}
      options={getPropOptions(prop)}
      idToTitle={idToTitle}
      placeholder={isEditor ? t('editor.add_options') : t('common.empty')}
      onCreate={val => {
        if (!isEditor) return;
        const nextOptions = [...getPropOptions(prop), val];
        // Persists the option to the schema (PATCH to the table)
        // and selects it in the current record. If the handler
        // doesn't exist, the value only remains in the metadata.
        if (onAddSchemaOption && currentTableId && prop.id) {
          onAddSchemaOption(currentTableId, prop.id, nextOptions);
        }
        handleMetaChange(prop.name, [...arrayValues(value), val]);
      }}
      onDeleteOption={val => {
        if (!isEditor) return;
        // Removes the option from the field's catalog and from the value
        // of this record. Other records keep the
        // their value (they are not rewritten here).
        if (onAddSchemaOption && currentTableId && prop.id) {
          onAddSchemaOption(currentTableId, prop.id, getPropOptions(prop).filter(o => normalizeOption(o)?.name !== val));
        }
        const cur = value ? arrayValues(value, true) : [];
        if (cur.includes(val)) handleMetaChange(prop.name, cur.filter(v => v !== val));
      }}
    />
  ) : prop.type === 'select' || prop.type === 'status' ? (
    <MultiSelectPills
        label={prop.name}
        disabled={!isEditor}
      single
      value={value}
      onChange={val => { if (isEditor) handleMetaChange(prop.name, val); }}
      options={getPropOptions(prop)}
      idToTitle={idToTitle}
      placeholder={isEditor ? t('editor.add_options') : t('common.empty')}
      onCreate={prop.type === 'select' ? (val => {
        if (!isEditor) return;
        const nextOptions = [...getPropOptions(prop), val];
        if (onAddSchemaOption && currentTableId && prop.id) {
          onAddSchemaOption(currentTableId, prop.id, nextOptions);
        }
        handleMetaChange(prop.name, val);
      }) : undefined}
      onDeleteOption={prop.type === 'select' ? (val => {
        if (!isEditor) return;
        if (onAddSchemaOption && currentTableId && prop.id) {
          onAddSchemaOption(currentTableId, prop.id, getPropOptions(prop).filter(o => normalizeOption(o)?.name !== val));
        }
        if (value === val) handleMetaChange(prop.name, '');
      }) : undefined}
    />
  ) : prop.type === 'autoria' ? (
    isEditor ? (
      <AutoriaEditor
        value={value}
        suggestions={dedupeAuthors(allNotes.map(n => n.metadata?.[prop.name]))}
        onSave={val => { handleMetaChange(prop.name, val); }}
      />
    ) : (
      <AutoriaDisplay value={value} emptyText={t('common.empty')} />
    )
  ) : prop.type === 'files' ? (
    <div className="w-full">
      {isEditor ? (
        <FileAttachmentField
          tableId={rawTableId}
          propertyName={prop.name}
          fileMode={typeof config.file_mode === 'string' ? config.file_mode : 'upload'}
          storageFolder={typeof config.storage_folder === 'string' ? config.storage_folder : 'assets'}
          namePattern={typeof config.name_pattern === 'string' ? config.name_pattern : ''}
          rowMetadata={metadata}
          value={value || ''}
          onChange={val => { handleMetaChange(prop.name, val); }}
        />
      ) : (
        <FileFieldValue value={value} field={prop.name} variant="detail" />
      )}
    </div>
  ) : prop.type === 'zotero' ? (
    <ZoteroPropertyValue value={value} fieldName={prop.name} editable={isEditor} onChange={val => { handleMetaChange(prop.name, val); }} />
  ) : prop.type === 'url' ? (
    <div className="flex items-center gap-1 w-full">
      <input aria-label={prop.name} disabled={!isEditor} type="url" value={inputValue(value)} onChange={e => { handleMetaChange(prop.name, e.target.value); }} placeholder={t('common.empty')} className="flex-1 min-w-0 bg-transparent border-none rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] transition-all placeholder:[var(--text-tertiary)]/20 font-medium h-7 disabled:cursor-not-allowed" />
      {Boolean(value) && (
        <a href={legacyText(value)} target="_blank" rel="noreferrer" onClick={e => { e.stopPropagation(); }} title={t('editor.open_url')} aria-label={t('editor.open_url')} className="shrink-0 p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-secondary)] transition-colors">
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  ) : prop.type === 'rich_text' ? (
    isEditor ? <textarea aria-label={prop.name} value={propertyDisplayText(value)} rows={3} onChange={e => { handleMetaChange(prop.name, e.target.value); }} placeholder={t('common.empty')} className="w-full resize-y bg-transparent rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)]" />
      : <span className="px-2 py-1 text-sm whitespace-pre-wrap break-words">{propertyDisplayText(value) || t('common.empty')}</span>
  ) : <ScalarPropertyValue prop={prop} context={context} />);
}
