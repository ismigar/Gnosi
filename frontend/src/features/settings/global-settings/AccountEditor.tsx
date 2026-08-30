import { AccountProviderChoices } from './AccountProviderChoices';
import { DavAccountForm } from './DavAccountForm';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { InlineEditorPlacement } from '../../../shared/ui/settings/SettingsPrimitives';
import { MailAccountForm } from './MailAccountForm';
import { X } from 'lucide-react';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: SettingsController };

export function AccountEditor({ context }: Props) {
  const { accountEditorTarget, activeTab, addAccountEmail, editingAccountId, setAddAccountEmail, setAddAccountEmailBlurred, setAddAccountType, setEditingAccountId, setIsManualGoogle, setManualPassword, setManualServer, t, tn } = context;
  return (<InlineEditorPlacement
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
  </InlineEditorPlacement>);
}
