import { ChevronRight } from 'lucide-react';
import { Database } from 'lucide-react';
import { GnosiToggle } from './SettingsPrimitives';
import { sortFieldItems } from '../../utils/fieldOrdering';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'databases' | 'draft' | 'isDatabasesExpanded' | 'renderFieldDefaultInput' | 'role' | 'setDraft' | 'setIsDatabasesExpanded' | 't' | 'tables' | 'tn'> };

export function GraphDatabases({ context }: Props) {
  const { databases, draft, isDatabasesExpanded, renderFieldDefaultInput, setDraft, setIsDatabasesExpanded, tables, tn } = context;
  return (<div style={{ background: 'var(--settings-bg)', borderRadius: '24px', border: '1px solid var(--settings-border)', overflow: 'hidden' }}>
    <div
      onClick={() => { setIsDatabasesExpanded(!isDatabasesExpanded); }}
      className="hover-bg"
      style={{
        padding: '16px 24px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: isDatabasesExpanded ? '1px solid var(--settings-border)' : 'none',
        transition: 'all 0.3s ease',
        background: isDatabasesExpanded ? 'var(--settings-sidebar-bg)' : 'transparent'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Database size={18} color="var(--gnosi-blue)" />
        <h5 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '800' }}>
          {tn('graph.databases')}
        </h5>
      </div>
      <ChevronRight
        size={18}
        color="var(--text-secondary)"
        style={{
          transform: isDatabasesExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          opacity: 0.6
        }}
      />
    </div>

    {isDatabasesExpanded && (
      <div className="animate-in" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Render formal databases */}
          {databases.map(db => {
            const isDbVisible = draft.graph.visible_databases?.includes(db.id);
            const dbTables = tables.filter(t => t.database_id === db.id);

            return (
              <div key={db.id} style={{ marginBottom: isDbVisible ? '12px' : '0' }}>
                <div className="hover-scale" style={{ padding: '16px 20px', borderRadius: '18px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '16px', transition: 'all 0.2s' }}>
                  <GnosiToggle
                    active={isDbVisible}
                    label={tn('graph.show_in_graph', { name: db.name })}
                    scale={0.8}
                    onChange={(e) => {
                      e.stopPropagation();
                      const checked = !isDbVisible;
                      setDraft(prev => ({
                        ...prev,
                        graph: { ...prev.graph, visible_databases: checked ? [...(prev.graph.visible_databases || []), db.id] : (prev.graph.visible_databases || []).filter(id => id !== db.id) }
                      }));
                    }}
                  />
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `${db.color || '#3b82f6'}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Database size={16} color={db.color || '#3b82f6'} />
                  </div>
                  <span style={{ fontWeight: '900', fontSize: '0.9rem', color: 'var(--text-primary)' }}>{db.name}</span>
                </div>

                {dbTables.length > 0 && (
                  <div style={{ marginLeft: '40px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {dbTables.map(table => {
                      const isTableVisible = draft.graph.visible_tables?.includes(table.id);
                      const tableFields = sortFieldItems(table.properties || []);

                      return (
                        <div key={table.id}>
                          <div className="hover-scale" style={{ padding: '12px 16px', borderRadius: '14px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.2s' }}>
                            <GnosiToggle
                              active={isTableVisible}
                              label={tn('graph.show_in_graph', { name: table.name })}
                              scale={0.7}
                              onChange={(e) => {
                                e.stopPropagation();
                                const checked = !isTableVisible;
                                setDraft(prev => ({
                                  ...prev,
                                  graph: { ...prev.graph, visible_tables: checked ? [...(prev.graph.visible_tables || []), table.id] : (prev.graph.visible_tables || []).filter(id => id !== table.id) }
                                }));
                              }}
                            />
                            <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{table.name}</span>
                          </div>

                          {isTableVisible && tableFields.length > 0 && (
                            <div style={{ marginLeft: '30px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {tableFields.map(field => {
                                const fieldKey = `${table.id}:${field.name}`;
                                const isExposed = draft.graph.visible_fields?.includes(fieldKey);
                                return (
                                  <div key={field.name} style={{ padding: '10px 14px', borderRadius: '12px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{field.name}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      {(() => {
                                        const toggleExposed = () => {
                                          const checked = !isExposed;
                                          setDraft(p => ({ ...p, graph: { ...p.graph, visible_fields: checked ? [...(p.graph.visible_fields || []), fieldKey] : (p.graph.visible_fields || []).filter(f => f !== fieldKey) } }));
                                        };
                                        return (
                                          <div role="switch" tabIndex={0} aria-checked={!!isExposed} aria-label={tn('graph.exposed_filter_field', { name: field.name })} className="gnosi-switch-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={toggleExposed} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleExposed(); } }}>
                                            <GnosiToggle display active={isExposed} scale={0.6} />
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{tn('graph.exposed_filter')}</span>
                                          </div>
                                        );
                                      })()}
                                      {renderFieldDefaultInput(field, fieldKey, tn('graph.default_value_placeholder'))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Orphan Tables / Other Structures */}
          {(() => {
            const orphanTables = tables.filter(t => !databases.some(db => db.id === t.database_id));
            if (orphanTables.length === 0) return null;

            return (
              <div style={{ marginTop: '24px', borderTop: '1px dashed var(--settings-border)', paddingTop: '24px' }}>
                <h6 style={{ fontSize: '0.75rem', fontWeight: '800', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px' }}>
                  {tn('graph.other_structures')}
                </h6>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr)', gap: '14px' }}>
                  {orphanTables.map(table => {
                    const isTableVisible = draft.graph.visible_tables?.includes(table.id);
                    const tableFields = sortFieldItems(table.properties || []);
                    return (
                      <div key={table.id}>
                        <div className="hover-scale" style={{ padding: '14px 18px', borderRadius: '16px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <GnosiToggle
                            active={isTableVisible}
                            label={tn('graph.show_in_graph', { name: table.name })}
                            scale={0.75}
                            onChange={() => {
                              const checked = !isTableVisible;
                              setDraft(p => ({ ...p, graph: { ...p.graph, visible_tables: checked ? [...(p.graph.visible_tables || []), table.id] : (p.graph.visible_tables || []).filter(id => id !== table.id) } }));
                            }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Database size={14} color="var(--text-secondary)" opacity={0.5} />
                              <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{table.name}</span>
                            </div>
                            {table.folder && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', opacity: 0.6, marginLeft: '22px' }}>{table.folder}</span>}
                          </div>
                        </div>
                        {isTableVisible && tableFields.length > 0 && (
                          <div style={{ marginLeft: '30px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {tableFields.map(field => {
                              const key = `${table.id}:${field.name}`;
                              const exposed = draft.graph.visible_fields?.includes(key);
                              return (
                                <div key={field.name} style={{ padding: '8px 12px', borderRadius: '10px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{field.name}</span>
                                  <GnosiToggle
                                    active={exposed}
                                    label={tn('graph.exposed_filter_field', { name: field.name })}
                                    scale={0.5}
                                    onChange={() => {
                                      const chk = !exposed;
                                      setDraft(p => ({ ...p, graph: { ...p.graph, visible_fields: chk ? [...(p.graph.visible_fields || []), key] : (p.graph.visible_fields || []).filter(f => f !== key) } }));
                                    }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    )}
  </div>);
}
