import { ChevronRight } from 'lucide-react';
import { GnosiToggle } from './SettingsPrimitives';
import { PenTool } from 'lucide-react';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'draft' | 'isSystemEntitiesExpanded' | 'renderFieldDefaultInput' | 'role' | 'setDraft' | 'setIsSystemEntitiesExpanded' | 'systemEntities' | 'tn'> };

export function GraphEntities({ context }: Props) {
  const { draft, isSystemEntitiesExpanded, renderFieldDefaultInput, setDraft, setIsSystemEntitiesExpanded, systemEntities, tn } = context;
  return (<div style={{ background: 'var(--settings-bg)', borderRadius: '24px', border: '1px solid var(--settings-border)', overflow: 'hidden' }}>
    <div
      onClick={() => { setIsSystemEntitiesExpanded(!isSystemEntitiesExpanded); }}
      className="hover-bg"
      style={{
        padding: '16px 24px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: isSystemEntitiesExpanded ? '1px solid var(--settings-border)' : 'none',
        transition: 'all 0.3s ease',
        background: isSystemEntitiesExpanded ? 'var(--settings-sidebar-bg)' : 'transparent'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <PenTool size={18} color="var(--gnosi-blue)" />
        <h5 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '800' }}>
          {tn('graph.system_entities')}
        </h5>
      </div>
      <ChevronRight
        size={18}
        color="var(--text-secondary)"
        style={{
          transform: isSystemEntitiesExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          opacity: 0.6
        }}
      />
    </div>

    {isSystemEntitiesExpanded && (
      <div className="animate-in" style={{ padding: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr)', gap: '14px' }}>
          {systemEntities.map(entity => {
            const isEntityVisible = draft.graph.visible_databases?.includes(entity.id);
            const subItems = entity.subItems || [];
            const entityFields = entity.fields;

            return (
              <div key={entity.id} style={{ marginBottom: isEntityVisible ? '12px' : '0' }}>
                <div className="hover-scale" style={{ padding: '16px 20px', borderRadius: '18px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '16px', transition: 'all 0.2s' }}>
                  <GnosiToggle
                    active={isEntityVisible}
                    label={tn('graph.show_in_graph', { name: entity.name })}
                    scale={0.8}
                    onChange={(e) => {
                      e.stopPropagation();
                      const checked = !isEntityVisible;
                      setDraft(prev => ({
                        ...prev,
                        graph: { ...prev.graph, visible_databases: checked ? [...(prev.graph.visible_databases || []), entity.id] : (prev.graph.visible_databases || []).filter(id => id !== entity.id) }
                      }));
                    }}
                  />
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `${entity.color || '#3b82f6'}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <entity.icon size={16} color={entity.color || '#3b82f6'} />
                  </div>
                  <span style={{ fontWeight: '900', fontSize: '0.9rem', color: 'var(--text-primary)' }}>{entity.name}</span>
                </div>

                {/* Sub-items (like Calendars or Mail accounts) */}
                {isEntityVisible && (subItems.length > 0 || entityFields.length > 0) && (
                  <div style={{ marginLeft: '40px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {subItems.map(item => {
                      const isItemVisible = draft.graph.visible_tables?.includes(item.id);

                      return (
                        <div key={item.id}>
                          <div className="hover-scale" style={{ padding: '12px 16px', borderRadius: '14px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.2s' }}>
                            <GnosiToggle
                              active={isItemVisible}
                              label={tn('graph.show_in_graph', { name: item.name })}
                              scale={0.7}
                              onChange={(e) => {
                                e.stopPropagation();
                                const checked = !isItemVisible;
                                setDraft(prev => ({
                                  ...prev,
                                  graph: { ...prev.graph, visible_tables: checked ? [...(prev.graph.visible_tables || []), item.id] : (prev.graph.visible_tables || []).filter(id => id !== item.id) }
                                }));
                              }}
                            />
                            <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{item.name}</span>
                          </div>

                          {/* Nested Fields for sub-item */}
                          {isItemVisible && entityFields.length > 0 && (
                            <div style={{ marginLeft: '30px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {entityFields.map(field => {
                                const fieldKey = `${item.id}:${field.name}`;
                                const isExposed = draft.graph.visible_fields?.includes(fieldKey);
                                return (
                                  <div key={field.name} style={{ padding: '10px 14px', borderRadius: '12px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{field.name}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      {(() => {
                                        const toggleExposed = () => {
                                          const checked = !isExposed;
                                          setDraft(prev => ({
                                            ...prev,
                                            graph: { ...prev.graph, visible_fields: checked ? [...(prev.graph.visible_fields || []), fieldKey] : (prev.graph.visible_fields || []).filter(f => f !== fieldKey) }
                                          }));
                                        };
                                        return (
                                          <div role="switch" tabIndex={0} aria-checked={!!isExposed} aria-label={tn('graph.exposed_filter_field', { name: field.name })} className="gnosi-switch-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={toggleExposed} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleExposed(); } }}>
                                            <GnosiToggle display active={isExposed} scale={0.6} />
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{tn('graph.exposed_filter')}</span>
                                          </div>
                                        );
                                      })()}
                                      {renderFieldDefaultInput(field, fieldKey, tn('graph.default_value_short'))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Fields for categories without sub-items (like Wiki) */}
                    {subItems.length === 0 && entityFields.length > 0 && (
                      <div style={{ marginLeft: '30px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {entityFields.map(field => {
                          const fieldKey = `${entity.id}:${field.name}`;
                          const isExposed = draft.graph.visible_fields?.includes(fieldKey);
                          return (
                            <div key={field.name} style={{ padding: '10px 14px', borderRadius: '12px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{field.name}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                {(() => {
                                  const toggleExposed = () => {
                                    const checked = !isExposed;
                                    setDraft(prev => ({
                                      ...prev,
                                      graph: { ...prev.graph, visible_fields: checked ? [...(prev.graph.visible_fields || []), fieldKey] : (prev.graph.visible_fields || []).filter(f => f !== fieldKey) }
                                    }));
                                  };
                                  return (
                                    <div role="switch" tabIndex={0} aria-checked={!!isExposed} aria-label={tn('graph.exposed_filter_field', { name: field.name })} className="gnosi-switch-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={toggleExposed} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleExposed(); } }}>
                                      <GnosiToggle display active={isExposed} scale={0.6} />
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{tn('graph.exposed_filter')}</span>
                                    </div>
                                  );
                                })()}
                                {renderFieldDefaultInput(field, fieldKey, tn('graph.default_value_short'))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    )}
  </div>);
}
