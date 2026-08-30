import { AccountList } from './AccountList';
import { AccountProviderChoices } from './AccountProviderChoices';
import { Calendar } from 'lucide-react';
import { Database } from 'lucide-react';
import { DavAccountForm } from './DavAccountForm';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { Globe } from 'lucide-react';
import { InlineEditorPlacement } from '../../../shared/ui/settings/SettingsPrimitives';
import { Mail } from 'lucide-react';
import { MailAccountForm } from './MailAccountForm';
import { Plus } from 'lucide-react';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { Users } from 'lucide-react';
import { X } from 'lucide-react';
import { bulkUpdateIntegrations } from '../../../shared/api/integrations';
import { updateDefaultCalendar } from '../../../shared/api/integrations';
import { updateDefaultContacts } from '../../../shared/api/integrations';
import { updateDefaultMail } from '../../../shared/api/integrations';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: SettingsController };

export function AccountsPanel({ context }: Props) {
  const { accountEditorTarget, activeTab, addAccountEmail, addAccountType, editingAccountId, googleSubCalendars, integrations, isAddingTable, setAddAccountEmail, setAddAccountEmailBlurred, setAddAccountType, setEditingAccountId, setIntegrations, setIsAddingTable, setIsManualGoogle, setManualPassword, setManualServer, t, tables, tn } = context;
  return (<Section
    title={activeTab === 'calendar' ? tn('calendar.manage_title') : (activeTab === 'contacts' ? tn('contacts.sync_section_title') : tn('mail_accounts.title'))}
    icon={activeTab === 'calendar' ? Calendar : (activeTab === 'contacts' ? Users : Mail)}
    extra={
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              setEditingAccountId(null);
              setAddAccountEmail('');
              setAddAccountEmailBlurred(false);
              setManualServer('');
              setManualPassword('');
              if (activeTab === 'calendar') {
                if (!addAccountType && !isAddingTable) {
                  setAddAccountType('menu');
                } else {
                  setAddAccountType(null);
                  setIsAddingTable(false);
                }
              } else {
                setAddAccountType(addAccountType === activeTab ? null : activeTab);
              }
              setIsManualGoogle(false);
            }}
            className="btn-gnosi-primary"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.85rem', borderRadius: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {(addAccountType || isAddingTable) ? <X size={16} /> : <Plus size={16} />}
            {(addAccountType || isAddingTable) ? t('common.cancel') : tn('accounts.add_account')}
          </button>

          {addAccountType === 'menu' && (
            <div className="animate-in" style={{
              position: 'absolute', top: '100%', right: 0, marginTop: '10px',
              background: 'var(--settings-bg)', border: '1px solid var(--settings-border)',
              borderRadius: '16px', boxShadow: '0 15px 40px rgba(0,0,0,0.2)',
              zIndex: 'var(--z-modal-dropdown)', width: '220px', overflow: 'hidden', padding: '6px'
            }}>
              <button
                onClick={(e) => { e.stopPropagation(); setIsAddingTable(true); setAddAccountType(null); }}
                className="hover-bg"
                style={{ width: '100%', padding: '12px 16px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-primary)', fontWeight: '700' }}
              >
                <Database size={16} color="var(--gnosi-blue)" /> {tn('accounts.vault_table')}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setAddAccountType('calendar'); }}
                className="hover-bg"
                style={{ width: '100%', padding: '12px 16px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-primary)', fontWeight: '700' }}
              >
                <Globe size={16} color="var(--gnosi-blue)" /> {tn('accounts.external_account')}
              </button>
            </div>
          )}
        </div>
      </div>
    }
  >
    <div style={{ minHeight: '340px', marginTop: '20px' }}>
      {/* Default calendar */}
      {activeTab === 'contacts' && (() => {
        const allContactSources = [
          ...(integrations.contacts || []),
          ...(integrations.mail_accounts || []),
          ...(integrations.emails || []),
        ];
        const seenC = new Set();
        const opts = allContactSources
          .filter(c => { const id = c.email || c.username; if (!id || seenC.has(id)) return false; seenC.add(id); return true; })
          .map(c => ({ id: c.email || c.username, label: c.name || c.email || c.username }));
        if (opts.length === 0) return null;
        return (
          <div style={{ marginBottom: '24px', padding: '18px 20px', background: 'var(--settings-sidebar-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: '800', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '10px' }}>
              {tn('accounts.default_account')}
            </label>
            <select
              value={integrations.default_contacts || ''}
              onChange={(e) => {
                const email = e.target.value;
                const updated = { ...integrations, default_contacts: email };
                setIntegrations(updated);
                updateDefaultContacts(email).catch(console.error);
              }}
              className="gnosi-input"
              style={{ width: '100%' }}
            >
              {opts.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '8px', marginBottom: 0 }}>
              {tn('accounts.default_contacts_hint')}
            </p>
          </div>
        );
      })()}
      {activeTab === 'mail' && (() => {
        const allMail = [...(integrations.mail_accounts || []), ...(integrations.emails || [])];
        const seen = new Set();
        const opts = allMail
          .filter(c => { const id = c.email || c.username; if (!id || seen.has(id)) return false; seen.add(id); return true; })
          .map(c => ({ id: c.email || c.username, label: c.name || c.email || c.username }));
        if (opts.length === 0) return null;
        return (
          <div style={{ marginBottom: '24px', padding: '18px 20px', background: 'var(--settings-sidebar-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: '800', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '10px' }}>
              {tn('accounts.default_account')}
            </label>
            <select
              value={integrations.default_mail || ''}
              onChange={(e) => {
                const email = e.target.value;
                const updated = { ...integrations, default_mail: email };
                setIntegrations(updated);
                updateDefaultMail(email).catch(console.error);
              }}
              className="gnosi-input"
              style={{ width: '100%' }}
            >
              {opts.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '8px', marginBottom: 0 }}>
              {tn('accounts.default_mail_hint')}
            </p>
          </div>
        );
      })()}
      {activeTab === 'calendar' && (() => {
        const subCalOpts = googleSubCalendars
          .filter(c => c.id && c.name)
          .map(c => ({ id: c.id, label: c.name, account: c.account }));
        const seenIds = new Set(subCalOpts.map(o => o.id));
        const accountOpts = (integrations.calendars || [])
          .filter(c => {
            const id = c.email || c.username || c.name;
            return id && !seenIds.has(id);
          })
          .map(c => ({ id: c.email || c.username || c.name, label: c.name || c.email || c.username }));
        const allCalOpts = [
          ...(tables.filter(t => integrations.vault_calendar?.enabled_tables?.includes(t.id)).map(t => ({ id: t.id, label: t.name }))),
          ...subCalOpts,
          ...accountOpts,
        ];
        if (allCalOpts.length === 0) return null;
        return (
          <div style={{ marginBottom: '24px', padding: '18px 20px', background: 'var(--settings-sidebar-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: '800', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '10px' }}>
              {tn('accounts.default_calendar')}
            </label>
            <select
              value={integrations.default_calendar || ''}
              onChange={(e) => {
                const source = e.target.value;
                const updated = { ...integrations, default_calendar: source };
                setIntegrations(updated);
                updateDefaultCalendar(source).catch(console.error);
              }}
              className="gnosi-input"
              style={{ width: '100%' }}
            >
              {allCalOpts.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '8px', marginBottom: 0 }}>
              {tn('accounts.default_calendar_hint')}
            </p>
          </div>
        );
      })()}
      {isAddingTable && (
        <div className="animate-in" style={{
          marginBottom: '32px', padding: '28px', borderRadius: '28px',
          background: 'var(--settings-sidebar-bg)', border: '1px solid rgba(59, 130, 246, 0.18)',
          boxShadow: '0 15px 40px rgba(59, 130, 246, 0.12)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '1000', color: 'var(--gnosi-blue)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{tn('accounts.select_vault_table')}</span>
            <button onClick={() => { setIsAddingTable(false); }} aria-label={t('settings.footer.close')} title={t('settings.footer.close')} className="icon-btn hover-bg-strong" style={{ padding: '8px', borderRadius: '12px' }}><X size={18} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', maxHeight: '400px', overflowY: 'auto', padding: '4px' }}>
            {tables.filter(t => !integrations.vault_calendar?.enabled_tables?.includes(t.id)).map(tbl => (
              <button
                key={tbl.id}
                onClick={() => {
                  const newList = [...(integrations.vault_calendar?.enabled_tables || []), tbl.id];
                  const updated = { ...integrations, vault_calendar: { ...integrations.vault_calendar, enabled_tables: newList } };
                  setIntegrations(updated);
                  bulkUpdateIntegrations(updated).catch(console.error);
                  setIsAddingTable(false);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px',
                  border: '1px solid var(--settings-border)', borderRadius: '16px',
                  background: 'var(--settings-bg)', cursor: 'pointer', fontWeight: '800',
                  color: 'var(--text-primary)', transition: 'all 0.2s', textAlign: 'left'
                }}
                className="hover-bg-strong"
              >
                <div style={{ background: 'var(--settings-sidebar-bg)', padding: '8px', borderRadius: '10px' }}>
                  <Database size={16} color="var(--gnosi-blue)" />
                </div>
                {tbl.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {addAccountType === activeTab && (
        <InlineEditorPlacement
          target={editingAccountId ? accountEditorTarget : null}
          waitForTarget={Boolean(editingAccountId)}
        >
          <div
            className={`settings-inline-editor animate-in ${editingAccountId ? 'is-attached' : 'is-create'}`}
            data-settings-editor-for={editingAccountId ? `account:${editingAccountId}` : 'account:new'}
          >
            {!editingAccountId && (
              <div className="settings-inline-editor-title">
                <span>{tn('accounts.account_config')}</span>
                <button onClick={() => { setAddAccountType(null); setAddAccountEmail(''); setAddAccountEmailBlurred(false); setIsManualGoogle(false); setManualServer(''); setManualPassword(''); setEditingAccountId(null); }} aria-label={t('settings.footer.close')} title={t('settings.footer.close')} className="icon-btn hover-bg-strong" style={{ padding: '8px', borderRadius: '12px' }}><X size={18} /></button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <FormGroup label={tn('accounts.email_address')}>
                <input
                  type="email"
                  className="gnosi-input"
                  value={addAccountEmail}
                  name="mail-account-username"
                  autoComplete="username"
                  onChange={e => {
                    setAddAccountEmail(e.target.value);
                    setAddAccountEmailBlurred(false);
                    setIsManualGoogle(false);
                  }}
                  onBlur={() => { setAddAccountEmailBlurred(true); }}
                  placeholder={tn('accounts.email_placeholder')}
                  data-autofocus="true"
                />
              </FormGroup>

              <AccountProviderChoices context={context} />
              {activeTab === 'mail' ? (
                <MailAccountForm context={context} />
              ) : (
                <DavAccountForm context={context} />
              )}
            </div>
          </div>
        </InlineEditorPlacement>
      )}

      <AccountList context={context} />
    </div>
  </Section>);
}
