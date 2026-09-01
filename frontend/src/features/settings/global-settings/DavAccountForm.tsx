import { Check } from 'lucide-react';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { PasswordInput } from './PasswordInput';
import { bulkUpdateIntegrations } from '../../../shared/api/integrations';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'activeTab' | 'addAccountEmail' | 'editingAccountId' | 'integrations' | 'loadIntegrations' | 'manualPassword' | 'manualServer' | 'setAddAccountEmail' | 'setAddAccountType' | 'setEditingAccountId' | 'setIsManualGoogle' | 'setManualPassword' | 'setManualServer' | 'setSavingStatus' | 'tn'> };

export function DavAccountForm({ context }: Props) {
  const { activeTab, addAccountEmail, editingAccountId, integrations, loadIntegrations, manualPassword, manualServer, setAddAccountEmail, setAddAccountType, setEditingAccountId, setIsManualGoogle, setManualPassword, setManualServer, setSavingStatus, tn } = context;
  return (<form onSubmit={(e) => {
    void (async () => {
      e.preventDefault();
      if (!addAccountEmail) return;
      if (activeTab !== 'mail' && (!manualServer || !manualPassword)) return;

      setSavingStatus('saving');
      try {
        const key = activeTab === 'calendar' ? 'calendars' : (activeTab === 'contacts' ? 'contacts' : 'mail_accounts');
        const currentList = integrations[key] || [];
        let newList;
        const newAcc = {
          id: editingAccountId || `manual_${String(Date.now())}`,
          email: addAccountEmail,
          username: addAccountEmail,
          provider: 'manual',
          server_url: manualServer,
          password: manualPassword,
          type: activeTab
        };
        if (editingAccountId) {
          newList = currentList.map(a => a.id === editingAccountId ? { ...a, ...newAcc } : a);
        } else {
          newList = [...currentList, newAcc];
        }

        await bulkUpdateIntegrations({
          ...integrations,
          [key]: newList
        });

        setSavingStatus('saved');
        setAddAccountType(null);
        setAddAccountEmail('');
        setIsManualGoogle(false);
        setManualServer('');
        setManualPassword('');
        setEditingAccountId(null);

        void loadIntegrations();
        setTimeout(() => { setSavingStatus('idle'); }, 2000);
      } catch (err) {
        console.error(err);
        setSavingStatus('error');
      }
    })();
  }} className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <FormGroup label={tn('accounts.server_url')} description={tn('accounts.server_url_desc')}>
      <input
        type="text"
        className="gnosi-input"
        value={manualServer}
        onChange={e => { setManualServer(e.target.value); }}
        placeholder="https://..."
      />
    </FormGroup>
    <FormGroup label={tn('accounts.password')}>
      <PasswordInput value={manualPassword} onChange={e => { setManualPassword(e.target.value); }} name="mail-account-password" autoComplete="current-password" />
    </FormGroup>

    <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
      <button type="submit" className="btn-gnosi-primary" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '14px 24px', flex: 1, fontWeight: '900', border: 'none', borderRadius: '16px', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 10px 20px rgba(59, 130, 246, 0.2)' }}>
        <Check size={18} />
        {editingAccountId ? tn('accounts.update_account') : tn('accounts.connect_account')}
      </button>

      {addAccountEmail.includes('@') && (
        <button
          onClick={() => { setIsManualGoogle(true); }}
          className="btn-gnosi-secondary"
          style={{ padding: '14px', borderRadius: '14px', fontSize: '0.8rem' }}
        >
          {tn('accounts.is_google')}
        </button>
      )}
    </div>
  </form>);
}
