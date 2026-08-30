import { Check } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { CollapsibleSection } from '../../../shared/ui/sections/CollapsibleSection';
import type { GraphPageController } from './useGraphPageController';


interface GraphFilterSectionsProps {
  readonly controller: GraphPageController;
}


interface FilterCheckboxProps {
  readonly active: boolean;
  readonly color: string;
  readonly id: string;
  readonly label: React.ReactNode;
  readonly onToggle: () => void;
  readonly small?: boolean;
  readonly title?: string;
}


function FilterCheckbox({
  active,
  color,
  id,
  label,
  onToggle,
  small = false,
  title,
}: FilterCheckboxProps) {
  return (
    <div className="filter-item-advanced" style={small ? { marginBottom: '4px' } : undefined}>
      <input
        type="checkbox"
        id={id}
        checked={active}
        onChange={onToggle}
        style={{ display: 'none' }}
      />
      <label
        htmlFor={id}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
      >
        <span
          className="custom-checkbox"
          style={{
            backgroundColor: color,
            height: small ? '14px' : undefined,
            opacity: active ? 1 : (small ? 0.2 : 0.3),
            width: small ? '14px' : undefined,
          }}
        >
          {active && <Check size={small ? 8 : 10} color="white" />}
        </span>
        <span
          className="filter-label-text"
          style={small ? { fontSize: '0.75rem' } : undefined}
          title={title}
        >
          {label}
        </span>
      </label>
    </div>
  );
}


function tableLabel(
  controller: GraphPageController,
  tableKey: string,
): string {
  const table = controller.availableTables.find(
    (record) => controller.tableId(record) === tableKey,
  );
  return (table ? controller.tableName(table) : null)
    ?? controller.folderNameByTableId.get(tableKey)
    ?? tableKey;
}


function systemTableLabel(
  tableId: string,
  fallback: string,
  translate: (key: string, defaultValue: string) => string,
): string {
  if (tableId === 'wiki') return translate('graph.entities.wiki', 'Wiki');
  if (tableId === 'drawings') return translate('graph.entities.drawings', 'Drawings');
  if (tableId === 'images') return translate('graph.entities.images', 'Images');
  if (tableId === 'assets') return translate('graph.entities.attachments', 'Attachments');
  if (tableId.startsWith('calendar:')) return translate('graph.entities.calendar', 'Calendar');
  if (tableId.startsWith('contact:')) return translate('graph.entities.contact', 'Contact');
  if (tableId.startsWith('mail:')) return translate('graph.entities.mail', 'Mail');
  return fallback;
}


export function GraphFilterSections({ controller }: GraphFilterSectionsProps) {
  const { t } = useTranslation();
  const hasMedia = controller.graphData?.nodes.some((node) => node.kind === 'media') ?? false;
  return (
    <>
      <CollapsibleSection
        title={t('graph.filters.tables_title', 'Table Filter')}
        badge={controller.activeTableFilters.size}
      >
        <div className="filter-list">
          {(controller.visibleDatabases.length === 0
            || controller.visibleDatabases.includes('wiki')) && (
            <FilterCheckbox
              active={controller.activeTableFilters.has('__wiki__')}
              color="#9C27B0"
              id="table-filter-__wiki__"
              label={<>📄 {t('graph.filters.wiki_pages', 'Wiki Pages')}</>}
              onToggle={() => {
                controller.toggleSetValue(controller.setActiveTableFilters, '__wiki__');
              }}
            />
          )}
          {controller.graphTableFiltersSettings.map((tableKey) => (
            <FilterCheckbox
              key={tableKey}
              active={controller.activeTableFilters.has(tableKey)}
              color="var(--gnosi-blue)"
              id={`table-filter-${tableKey}`}
              label={tableLabel(controller, tableKey)}
              onToggle={() => {
                controller.toggleSetValue(controller.setActiveTableFilters, tableKey);
              }}
            />
          ))}
        </div>
      </CollapsibleSection>

      {hasMedia && (
        <CollapsibleSection
          title={t('graph.filters.media_tags_title', 'Photo Tags Filter')}
          badge={controller.activeMediaTags.size}
          defaultOpen
        >
          <div className="filter-list">
            {controller.mediaTagsList.map((tag) => (
              <FilterCheckbox
                key={tag}
                active={controller.activeMediaTags.has(tag)}
                color="#ec4899"
                id={`media-tag-${tag}`}
                label={`#${tag}`}
                onToggle={() => {
                  controller.toggleSetValue(controller.setActiveMediaTags, tag);
                }}
              />
            ))}
            {controller.mediaTagsList.length === 0 && (
              <p style={{ fontSize: '0.75rem', color: '#888', margin: '10px 0' }}>
                {t('graph.filters.no_tags_found', 'No tags found in photos')}
              </p>
            )}
          </div>
        </CollapsibleSection>
      )}

      {controller.visibleFields.length > 0 && (
        <CollapsibleSection
          title={t('graph.filters.fields_title', 'Field Filter')}
          badge={controller.visibleFields.length}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '10px' }}>
            {controller.visibleFields.map((fieldKey) => {
              if (!fieldKey.includes(':')) return null;
              const [tableId = '', fieldName = ''] = fieldKey.split(':');
              const registered = controller.availableTables.find(
                (record) => controller.tableId(record) === tableId,
              );
              const fallback = controller.folderNameByTableId.get(tableId) ?? tableId;
              const registeredName = registered ? controller.tableName(registered) : null;
              const resolvedName = registeredName
                || systemTableLabel(tableId, fallback, t);
              const values = controller.fieldValuesByKey[fieldKey] ?? [];
              return (
                <div key={fieldKey} style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '8px' }}>
                  <h5 style={{ fontSize: '0.8rem', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '12px' }}>⚙</span>
                    {resolvedName}: {fieldName}
                  </h5>
                  {values.length === 0 ? (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                      {t('graph.filters.no_values', 'No values (the graph is empty)')}
                    </p>
                  ) : (
                    <div className="filter-list" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                      {values.map(([value, count]) => (
                        <FilterCheckbox
                          key={value}
                          active={controller.fieldFilters[fieldKey]?.has(value) ?? false}
                          color="var(--gnosi-blue)"
                          id={`field-${fieldKey}-${value}`}
                          label={`${controller.displayFieldValue(value)} (${String(count)})`}
                          title={value}
                          small
                          onToggle={() => {
                            controller.setFieldFilters((current) => {
                              const next = { ...current };
                              const selected = new Set(next[fieldKey] ?? []);
                              if (selected.has(value)) selected.delete(value);
                              else selected.add(value);
                              next[fieldKey] = selected;
                              return next;
                            });
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {controller.graphTableFiltersSettings.length === 0
        && controller.visibleFields.length === 0 && (
        <div style={{ padding: '15px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          <p>{t('graph.filters.none_configured', 'No filters configured.')}</p>
          <p style={{ marginTop: '5px' }}>
            <Trans i18nKey="graph.filters.none_configured_hint">
              Ves a <strong>Configuració → Graf</strong> per seleccionar taules i camps.
            </Trans>
          </p>
        </div>
      )}
    </>
  );
}
