import { configurableGap } from './settingsStyles';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { Plus } from 'lucide-react';
import { Rss } from 'lucide-react';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { SettingsSectionTabs } from '../../../shared/ui/settings/SettingsSectionTabs';
import { Share2 } from 'lucide-react';
import { SocialNetworkIcon } from '../../social/components/network/social/SocialNetworkIcon';
import { Trash2 } from 'lucide-react';
import { X } from 'lucide-react';
import { isKnownSocialNetwork } from '../../social/components/network/social/socialNetworkModel';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'handleAddSocialStream' | 'newStreamForm' | 'saveSocialNetworks' | 'saveSocialStreams' | 'setNewStreamForm' | 'setShowAddStream' | 'setSocialSection' | 'showAddStream' | 'socialNetworks' | 'socialSection' | 'socialStreams' | 't' | 'tn'> };

export function SocialPanel({ context }: Props) {
  const { handleAddSocialStream, newStreamForm, saveSocialNetworks, saveSocialStreams, setNewStreamForm, setShowAddStream, setSocialSection, showAddStream, socialNetworks, socialSection, socialStreams, t, tn } = context;
  return (<>
    <SettingsSectionTabs
      ariaLabel={tn('social.sections_label')}
      activeId={socialSection}
      onChange={setSocialSection}
      items={[
        { id: 'networks', icon: Share2, label: tn('social.networks_title') },
        { id: 'streams', icon: Rss, label: tn('social.streams_title') },
      ]}
    />

    {socialSection === 'networks' && (
      <Section title={tn('social.networks_title')} icon={Share2}>
        <div className="settings-configurable-list" style={{ ...configurableGap('10px') }}>
          {socialNetworks.map(net => (
            <div
              key={net.id}
              className="settings-configurable-item"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'var(--settings-sidebar-bg)', borderRadius: '14px', border: '1px solid var(--settings-border)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {isKnownSocialNetwork(net.id)
                  ? <SocialNetworkIcon network={net.id} size={26} />
                  : <span aria-hidden="true" style={{ fontSize: '1.4rem' }}>{net.icon}</span>}
                <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{net.name}</span>
              </div>
              <GnosiToggle
                active={net.enabled}
                label={tn('social.enable_network', { name: net.name })}
                onChange={() => {
                  const updated = socialNetworks.map(n => n.id === net.id ? { ...n, enabled: !n.enabled } : n);
                  void saveSocialNetworks(updated);
                }}
              />
            </div>
          ))}
        </div>
      </Section>
    )}

    {socialSection === 'streams' && (
      <Section title={tn('social.streams_title')} icon={Rss} extra={
        <button onClick={() => { setShowAddStream(v => !v); }} className="btn-gnosi-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', fontSize: '0.85rem', borderRadius: '10px' }}>
          {showAddStream ? <X size={15} /> : <Plus size={15} />}
          {showAddStream ? t('common.cancel') : tn('social.add_stream')}
        </button>
      }>
        {showAddStream && (
          <div style={{ padding: '16px', background: 'var(--settings-sidebar-bg)', borderRadius: '14px', border: '1px solid var(--settings-border)', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label className="settings-label">{tn('social.internal_id')}</label>
                <input className="gnosi-input" placeholder={tn('social.internal_id_placeholder')} value={newStreamForm.id} onChange={e => { setNewStreamForm(f => ({ ...f, id: e.target.value })); }} />
              </div>
              <div>
                <label className="settings-label">{tn('social.title_label')}</label>
                <input className="gnosi-input" placeholder={tn('social.title_placeholder')} value={newStreamForm.title} onChange={e => { setNewStreamForm(f => ({ ...f, title: e.target.value })); }} />
              </div>
              <div>
                <label className="settings-label">{tn('social.icon_label')}</label>
                <input className="gnosi-input" placeholder="📡" value={newStreamForm.icon} onChange={e => { setNewStreamForm(f => ({ ...f, icon: e.target.value })); }} />
              </div>
              <div>
                <label className="settings-label">{tn('social.network_label')}</label>
                <select className="gnosi-input" value={newStreamForm.network} onChange={e => { setNewStreamForm(f => ({ ...f, network: e.target.value })); }}>
                  {socialNetworks.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                  <option value="scheduled">{tn('social.scheduled')}</option>
                </select>
              </div>
            </div>
            <button onClick={handleAddSocialStream} className="btn-gnosi-primary" style={{ alignSelf: 'flex-end', padding: '8px 20px', borderRadius: '10px', fontSize: '0.85rem' }}>
              {tn('social.add')}
            </button>
          </div>
        )}
        <div className="settings-configurable-list" style={{ ...configurableGap('8px') }}>
          {socialStreams.length === 0 && (
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', padding: '20px', textAlign: 'center' }}>
              {tn('social.no_streams')}
            </div>
          )}
          {socialStreams.map(stream => (
            <div key={stream.id} className="settings-configurable-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--settings-sidebar-bg)', borderRadius: '12px', border: '1px solid var(--settings-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {isKnownSocialNetwork(stream.network)
                  ? <SocialNetworkIcon network={stream.network} size={21} />
                  : <span style={{ fontSize: '1.2rem' }}>{stream.icon}</span>}
                <div>
                  <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '0.9rem' }}>{stream.title}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{stream.network} · {stream.id}</div>
                </div>
              </div>
              <button
                onClick={() => {
                  const updated = socialStreams.filter(s => s.id !== stream.id);
                  void saveSocialStreams(updated);
                }}
                style={{ padding: '6px', borderRadius: '8px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                className="hover-bg"
                title={t('common.delete')}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </Section>
    )}
  </>);
}
