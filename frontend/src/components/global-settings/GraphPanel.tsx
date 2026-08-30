import { Database } from 'lucide-react';
import { FormGroup } from './SettingsPrimitives';
import { GnosiToggle } from './SettingsPrimitives';
import { GraphDatabases } from './GraphDatabases';
import { GraphEntities } from './GraphEntities';
import { Palette } from 'lucide-react';
import { Section } from './SettingsPrimitives';
import { SettingsSectionTabs } from '../SettingsSectionTabs';
import { Share2 } from 'lucide-react';
import { Zap } from 'lucide-react';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: SettingsController };

export function GraphPanel({ context }: Props) {
  const { draft, graphSection, setDraft, setGraphSection, tn } = context;
  return (<>
    <SettingsSectionTabs
      ariaLabel={tn('graph.sections_label')}
      activeId={graphSection}
      onChange={setGraphSection}
      items={[
        { id: 'engine', icon: Share2, label: tn('graph.visual_engine') },
        { id: 'structures', icon: Database, label: tn('graph.visible_structures') },
      ]}
    />
    {graphSection === 'engine' && (
      <Section title={tn('graph.section_title')} icon={Share2}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '50px', marginBottom: '50px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
              <Palette size={18} color="var(--gnosi-blue)" />
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--gnosi-blue)', fontWeight: '1000', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{tn('graph.aesthetics')}</h4>
            </div>
            <FormGroup label={tn('graph.node_size_value', { value: draft.graph.node_size.toFixed(1) })}>
              <input type="range" className="gnosi-range" min="0.1" max="5" step="0.1" value={draft.graph.node_size} onChange={e => { setDraft({ ...draft, graph: { ...draft.graph, node_size: parseFloat(e.target.value) } }); }} />
            </FormGroup>
            <FormGroup label={tn('graph.edge_thickness_value', { value: draft.graph.edge_thickness.toFixed(1) })}>
              <input type="range" className="gnosi-range" min="0.1" max="5" step="0.1" value={draft.graph.edge_thickness} onChange={e => { setDraft({ ...draft, graph: { ...draft.graph, edge_thickness: parseFloat(e.target.value) } }); }} />
            </FormGroup>
            <div className="settings-hover-card" style={{ marginTop: '20px', padding: '20px', background: 'var(--settings-sidebar-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
              <FormGroup label={tn('graph.directionality')} description={tn('graph.directionality_desc')} horizontal>
                <GnosiToggle
                  active={draft.graph.show_arrows}
                  label={tn('graph.directionality')}
                  onChange={() => { setDraft({ ...draft, graph: { ...draft.graph, show_arrows: !draft.graph.show_arrows } }); }}
                />
              </FormGroup>
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
              <Zap size={18} color="var(--gnosi-blue)" />
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--gnosi-blue)', fontWeight: '1000', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{tn('graph.physics_realtime')}</h4>
            </div>
            <FormGroup label={tn('graph.gravity_value', { value: draft.graph.physics.gravity })}>
              <input type="range" className="gnosi-range" min="0" max="2" step="0.05" value={draft.graph.physics.gravity} onChange={e => { setDraft({ ...draft, graph: { ...draft.graph, physics: { ...draft.graph.physics, gravity: parseFloat(e.target.value) } } }); }} />
            </FormGroup>
            <FormGroup label={tn('graph.repulsion_value', { value: draft.graph.physics.repulsion })}>
              <input type="range" className="gnosi-range" min="0" max="10000" step="100" value={draft.graph.physics.repulsion} onChange={e => { setDraft({ ...draft, graph: { ...draft.graph, physics: { ...draft.graph.physics, repulsion: parseInt(e.target.value) } } }); }} />
            </FormGroup>
            <FormGroup label={tn('graph.friction_value', { value: draft.graph.physics.friction })}>
              <input type="range" className="gnosi-range" min="1" max="20" step="1" value={draft.graph.physics.friction} onChange={e => { setDraft({ ...draft, graph: { ...draft.graph, physics: { ...draft.graph.physics, friction: parseInt(e.target.value) } } }); }} />
            </FormGroup>
          </div>
        </div>

      </Section>
    )}
    {graphSection === 'structures' && (
      <Section title={tn('graph.visible_structures')} icon={Database}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {/* Databases and Tables */}
          <GraphDatabases context={context} />

          {/* System Entities */}
          <GraphEntities context={context} />
        </div>
      </Section>
    )}
  </>);
}
