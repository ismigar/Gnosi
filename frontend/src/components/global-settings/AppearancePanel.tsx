import { writeStorage, themeKey, mailDarkBodyKey } from './settingsStorage';
import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import { GnosiToggle } from './SettingsPrimitives';
import { Monitor } from 'lucide-react';
import { Palette } from 'lucide-react';
import { Section } from './SettingsPrimitives';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'activeTab' | 'draft' | 'mailDarkBody' | 'setDraft' | 'setMailDarkBody' | 'tn'> };

export function AppearancePanel({ context }: Props) {
  const { activeTab, draft, mailDarkBody, setDraft, setMailDarkBody, tn } = context;
  return (activeTab === 'appearance' && (
    <Section title={tn('appearance.section_title')} icon={Palette}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '56px' }}>
        {[
          { id: 'light', label: tn('appearance.theme_light'), icon: Monitor, bg: '#ffffff' },
          { id: 'dark', label: tn('appearance.theme_dark'), icon: Monitor, bg: '#000000' },
          { id: 'system', label: tn('appearance.theme_system'), icon: Monitor, bg: 'linear-gradient(135deg, #fff 50%, #000 50%)' }
        ].map(opt => (
          <button key={opt.id} className={`settings-hover-card ${draft.settings.theme === opt.id ? 'is-selected' : ''}`} onClick={() => {
            setDraft({ ...draft, settings: { ...draft.settings, theme: opt.id } });
            // Wire the selector into the theme engine (useTheme / index.html bootstrap
            // read the persisted 'db-theme' key and react to 'db-theme-changed').
            writeStorage(themeKey, opt.id);
            dispatchWindowEvent(new Event('db-theme-changed'));
          }} style={{
            padding: '12px', borderRadius: '24px', border: `2px solid ${draft.settings.theme === opt.id ? 'var(--gnosi-blue)' : 'var(--settings-border)'}`,
            background: draft.settings.theme === opt.id ? 'rgba(59, 130, 246, 0.05)' : 'transparent', cursor: 'pointer', transition: 'all 0.3s'
          }}>
            <div style={{ height: '80px', borderRadius: '16px', background: opt.bg, border: '1px solid var(--settings-border)', marginBottom: '12px', boxShadow: '0 8px 20px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Monitor size={24} color={opt.id === 'light' ? '#ccc' : (opt.id === 'dark' ? '#444' : '#888')} />
            </div>
            <div style={{ fontWeight: '800', fontSize: '0.9rem', color: 'var(--text-primary)', textAlign: 'center' }}>{opt.label}</div>
          </button>
        ))}
      </div>

      <div className="settings-hover-card" style={{ background: 'var(--settings-sidebar-bg)', padding: '32px', borderRadius: '28px', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 10px 30px rgba(0,0,0,0.03)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: '900', color: 'var(--text-primary)', fontSize: '1.15rem' }}>{tn('appearance.reduce_fx_title')}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '6px', opacity: 0.8, maxWidth: '420px' }}>{tn('appearance.reduce_fx_desc')}</div>
        </div>
        <GnosiToggle
          active={draft.settings.reduce_animations}
          label={tn('appearance.reduce_fx_title')}
          scale={1.2}
          onChange={() => { setDraft({ ...draft, settings: { ...draft.settings, reduce_animations: !draft.settings.reduce_animations } }); }}
        />
      </div>

      <div className="settings-hover-card" style={{ background: 'var(--settings-sidebar-bg)', padding: '32px', borderRadius: '28px', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 10px 30px rgba(0,0,0,0.03)', marginTop: '20px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: '900', color: 'var(--text-primary)', fontSize: '1.15rem' }}>{tn('appearance.mail_dark_title')}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '6px', opacity: 0.8, maxWidth: '480px' }}>{tn('appearance.mail_dark_desc')}</div>
        </div>
        <GnosiToggle
          active={mailDarkBody}
          label={tn('appearance.mail_dark_title')}
          scale={1.2}
          onChange={() => {
            const next = !mailDarkBody;
            setMailDarkBody(next);
            try { writeStorage(mailDarkBodyKey, next ? '1' : '0'); } catch {
              // Storage can be unavailable in restricted browser contexts.
            }
            try { dispatchWindowEvent(new Event('gnosi-mail-dark-body-changed')); } catch {
              // The event target may be unavailable while the modal unmounts.
            }
          }}
        />
      </div>
    </Section>
  ));
}
