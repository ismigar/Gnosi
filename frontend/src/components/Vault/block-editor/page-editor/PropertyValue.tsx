import { inputValue, legacyText, arrayValues } from './valueBoundaries';
import { AutoriaDisplay } from '../../AutoriaField';
import { AutoriaEditor } from '../../AutoriaField';
import { ExternalLink } from 'lucide-react';
import { FileAttachmentField } from '../../FileAttachmentField';
import { FileFieldValue } from '../../FileFieldValue';
import { MultiSelectPills } from '../property-controls/MultiSelectPills';
import { ScalarPropertyValue } from './ScalarPropertyValue';
import { dedupeAuthors } from '../../autoriaUtils';
import { normalizeOption } from '../../optionCatalogUtils';
import type { PageEditorController } from './usePageEditorController';
import type { PageProperty } from './types';
export function PropertyValue({ context, prop }: { context: PageEditorController; prop: PageProperty }) {
  const { allNotes, metadata, idToTitle, isEditor, handleMetaChange, t, onOpenInNewTab, onOpenPage, handleRelationRemove, getPropOptions, onAddSchemaOption, currentTableId, rawTableId } = context;
  return (prop.type === 'relation' ? (() => {
    const relatedTableId = prop.relation_database_id;
    const relatedNotes = allNotes.filter(n => {
      const nTableId = n.resolved_table_id || n.metadata?.table_id || n.metadata?.database_table_id;
      return nTableId === relatedTableId;
    });
    const options = relatedNotes.map(n => n.id);
    const relatedMap = { ...idToTitle, ...Object.fromEntries(relatedNotes.map(n => [n.id, n.title || idToTitle[n.id] || n.id])) };
    return (
      <MultiSelectPills
        value={metadata[prop.name]}
        onChange={val => { if (isEditor) handleMetaChange(prop.name, val); }}
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
      value={metadata[prop.name]}
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
        handleMetaChange(prop.name, [...arrayValues(metadata[prop.name]), val]);
      }}
      onDeleteOption={val => {
        if (!isEditor) return;
        // Removes the option from the field's catalog and from the value
        // of this record. Other records keep the
        // their value (they are not rewritten here).
        if (onAddSchemaOption && currentTableId && prop.id) {
          onAddSchemaOption(currentTableId, prop.id, getPropOptions(prop).filter(o => normalizeOption(o)?.name !== val));
        }
        const cur = metadata[prop.name] ? arrayValues(metadata[prop.name], true) : [];
        if (cur.includes(val)) handleMetaChange(prop.name, cur.filter(v => v !== val));
      }}
    />
  ) : prop.type === 'select' || prop.type === 'status' ? (
    <MultiSelectPills
      single
      value={metadata[prop.name]}
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
        if (metadata[prop.name] === val) handleMetaChange(prop.name, '');
      }) : undefined}
    />
  ) : prop.type === 'autoria' ? (
    isEditor ? (
      <AutoriaEditor
        value={metadata[prop.name]}
        suggestions={dedupeAuthors(allNotes.map(n => n.metadata?.[prop.name]))}
        onSave={val => { handleMetaChange(prop.name, val); }}
      />
    ) : (
      <AutoriaDisplay value={metadata[prop.name]} emptyText={t('common.empty')} />
    )
  ) : prop.type === 'files' ? (
    <div className="w-full">
      {isEditor ? (
        <FileAttachmentField
          tableId={rawTableId}
          propertyName={prop.name}
          fileMode={prop.file_mode || 'upload'}
          storageFolder={prop.storage_folder || 'assets'}
          namePattern={prop.name_pattern || ''}
          rowMetadata={metadata}
          value={metadata[prop.name] || ''}
          onChange={val => { handleMetaChange(prop.name, val); }}
        />
      ) : (
        <FileFieldValue value={metadata[prop.name]} field={prop.name} variant="detail" />
      )}
    </div>
  ) : prop.type === 'url' ? (
    <div className="flex items-center gap-1 w-full">
      <input disabled={!isEditor} type="text" value={inputValue(metadata[prop.name])} onChange={e => { handleMetaChange(prop.name, e.target.value); }} placeholder={t('common.empty')} className="flex-1 min-w-0 bg-transparent border-none rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] transition-all placeholder:[var(--text-tertiary)]/20 font-medium h-7 disabled:cursor-not-allowed" />
      {Boolean(metadata[prop.name]) && (
        <a href={legacyText(metadata[prop.name])} target="_blank" rel="noreferrer" onClick={e => { e.stopPropagation(); }} title={t('editor.open_url')} aria-label={t('editor.open_url')} className="shrink-0 p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-secondary)] transition-colors">
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  ) : <ScalarPropertyValue prop={prop} context={context} />);
}
