import { errorDetail } from './settingsDocuments';
import { AliasEditor } from './AliasEditor';
import { Check } from 'lucide-react';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import MailBlockEditor from '../../mail/editor/Mail/MailBlockEditor';
import { PasswordInput } from './PasswordInput';
import { RefreshCw } from 'lucide-react';
import { bulkUpdateIntegrations } from '../../../shared/api/integrations';
import { testEmailIntegration } from '../../../shared/api/integrations';
import { toast } from '../../../shared/notifications/toast';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'addAccountEmail' | 'editingAccountId' | 'integrations' | 'loadIntegrations' | 'mailAliases' | 'mailCertificate' | 'mailDisplayName' | 'mailImapEnc' | 'mailImapHost' | 'mailImapPass' | 'mailImapPort' | 'mailImapUser' | 'mailSignature' | 'mailSmtpEnc' | 'mailSmtpHost' | 'mailSmtpPass' | 'mailSmtpPort' | 'mailSmtpUser' | 'mailSubjectPrefix' | 'mailTestStatus' | 'setAddAccountEmail' | 'setAddAccountType' | 'setEditingAccountId' | 'setMailAliases' | 'setMailCertificate' | 'setMailDisplayName' | 'setMailImapEnc' | 'setMailImapHost' | 'setMailImapPass' | 'setMailImapPort' | 'setMailImapUser' | 'setMailSignature' | 'setMailSmtpEnc' | 'setMailSmtpHost' | 'setMailSmtpPass' | 'setMailSmtpPort' | 'setMailSmtpUser' | 'setMailSubjectPrefix' | 'setMailTestStatus' | 'setSavingStatus' | 't' | 'tn'> };

export function MailAccountForm({ context }: Props) {
  const { addAccountEmail, editingAccountId, integrations, loadIntegrations, mailAliases, mailCertificate, mailDisplayName, mailImapEnc, mailImapHost, mailImapPass, mailImapPort, mailImapUser, mailSignature, mailSmtpEnc, mailSmtpHost, mailSmtpPass, mailSmtpPort, mailSmtpUser, mailSubjectPrefix, mailTestStatus, setAddAccountEmail, setAddAccountType, setEditingAccountId, setMailAliases, setMailCertificate, setMailDisplayName, setMailImapEnc, setMailImapHost, setMailImapPass, setMailImapPort, setMailImapUser, setMailSignature, setMailSmtpEnc, setMailSmtpHost, setMailSmtpPass, setMailSmtpPort, setMailSmtpUser, setMailSubjectPrefix, setMailTestStatus, setSavingStatus, t, tn } = context;
  return (<form onSubmit={(e) => {
    void (async () => {
      e.preventDefault();
      if (!addAccountEmail) return;

      const mailAcc = {
        id: editingAccountId || `mail_${String(Date.now())}`,
        email: addAccountEmail,
        provider: 'manual',
        display_name: mailDisplayName,
        subject_prefix: mailSubjectPrefix,
        imap_host: mailImapHost,
        imap_port: mailImapPort,
        imap_user: mailImapUser,
        imap_password: mailImapPass,
        imap_encryption: mailImapEnc,
        smtp_host: mailSmtpHost,
        smtp_port: mailSmtpPort,
        smtp_user: mailSmtpUser,
        smtp_password: mailSmtpPass,
        smtp_encryption: mailSmtpEnc,
        signature: mailSignature,
        certificate: mailCertificate,
        aliases: mailAliases,
        type: 'mail'
      };
      const key = 'mail_accounts';
      const currentList = integrations[key] || [];
      const newList = editingAccountId
        ? currentList.map(a => a.id === editingAccountId ? mailAcc : a)
        : [...currentList, mailAcc];

      if (editingAccountId && mailImapHost) {
        // Edit mode: test the IMAP/SMTP connection
        setMailTestStatus('testing');
        try {
          await bulkUpdateIntegrations({ ...integrations, [key]: newList });
          const result = await testEmailIntegration({
            imap_server: mailImapHost,
            imap_port: mailImapPort,
            imap_encryption: mailImapEnc,
            smtp_server: mailSmtpHost,
            smtp_port: mailSmtpPort,
            smtp_encryption: mailSmtpEnc,
            username: mailImapUser || addAccountEmail,
            password: mailImapPass,
          });
          const ok = result.success;
          setMailTestStatus(ok ? 'ok' : 'error');
          toast[ok ? 'success' : 'error'](ok ? tn('accounts.test_ok') : tn('accounts.test_error', { error: result.error || tn('accounts.could_not_connect') }));
          if (ok) void loadIntegrations();
        } catch (err) {
          setMailTestStatus('error');
          toast.error(tn('accounts.test_conn_error', { detail: errorDetail(err, tn('accounts.unknown_error')) }));
        }
      } else {
        // New account mode: saves and closes
        setSavingStatus('saving');
        try {
          await bulkUpdateIntegrations({ ...integrations, [key]: newList });
          setSavingStatus('saved');
          setAddAccountType(null);
          setAddAccountEmail('');
          setMailDisplayName(''); setMailSubjectPrefix(''); setMailAliases([]);
          setMailImapHost(''); setMailImapPort('993'); setMailImapUser(''); setMailImapPass(''); setMailImapEnc('ssl');
          setMailSmtpHost(''); setMailSmtpPort('465'); setMailSmtpUser(''); setMailSmtpPass(''); setMailSmtpEnc('ssl');
          setMailSignature(''); setMailCertificate('');
          setEditingAccountId(null);
          void loadIntegrations();
          setTimeout(() => { setSavingStatus('idle'); }, 2000);
        } catch (err) {
          setSavingStatus('error');
          toast.error(tn('accounts.save_error', { detail: errorDetail(err, tn('accounts.unknown_error')) }));
        }
      }
    })();
  }} className="animate-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
    {/* SENDER NAME + ALIASES */}
    <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px 20px', background: 'var(--settings-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
      <div>
        <FormGroup label={tn('accounts.sender_name')} description={tn('accounts.sender_name_desc')}>
          <input
            type="text"
            className="gnosi-input"
            value={mailDisplayName}
            onChange={e => { setMailDisplayName(e.target.value); }}
            placeholder={tn('accounts.sender_name_placeholder')}
          />
        </FormGroup>
      </div>
      <div>
        <FormGroup label={tn('accounts.aliases_label')} description={tn('accounts.aliases_desc')}>
          <AliasEditor aliases={mailAliases} onChange={setMailAliases} />
        </FormGroup>
      </div>
      <div style={{ gridColumn: 'span 2' }}>
        <FormGroup label={tn('accounts.subject_prefix')} description={tn('accounts.subject_prefix_desc')}>
          <input
            type="text"
            className="gnosi-input"
            value={mailSubjectPrefix}
            onChange={e => { setMailSubjectPrefix(e.target.value); }}
            placeholder={tn('accounts.subject_prefix_placeholder')}
          />
        </FormGroup>
      </div>
    </div>

    {/* IMAP SECTION */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', background: 'var(--settings-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
      <h4 style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--gnosi-blue)', fontWeight: '900', textTransform: 'uppercase' }}>{tn('accounts.imap_section')}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
        <FormGroup label={tn('accounts.server')}><input type="text" className="gnosi-input" value={mailImapHost} onChange={e => { setMailImapHost(e.target.value); }} placeholder="imap.pangea.org" /></FormGroup>
        <FormGroup label={tn('accounts.port')}><input type="text" className="gnosi-input" value={mailImapPort} onChange={e => { setMailImapPort(e.target.value); }} placeholder="993" /></FormGroup>
      </div>
      <FormGroup label={tn('accounts.user')}><input type="text" className="gnosi-input" value={mailImapUser} onChange={e => { setMailImapUser(e.target.value); }} name="imap-username" autoComplete="username" /></FormGroup>
      <FormGroup label={tn('accounts.password')}><PasswordInput value={mailImapPass} onChange={e => { setMailImapPass(e.target.value); }} name="imap-password" autoComplete="current-password" /></FormGroup>
      <FormGroup label={tn('accounts.security')}>
        <select className="gnosi-select" value={mailImapEnc} onChange={e => { setMailImapEnc(e.target.value); }}>
          <option value="ssl">SSL/TLS</option>
          <option value="starttls">STARTTLS</option>
          <option value="none">{tn('accounts.security_none')}</option>
        </select>
      </FormGroup>
    </div>

    {/* SMTP SECTION */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', background: 'var(--settings-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
      <h4 style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--gnosi-blue)', fontWeight: '900', textTransform: 'uppercase' }}>{tn('accounts.smtp_section')}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
        <FormGroup label={tn('accounts.server')}><input type="text" className="gnosi-input" value={mailSmtpHost} onChange={e => { setMailSmtpHost(e.target.value); }} placeholder="smtp.pangea.org" /></FormGroup>
        <FormGroup label={tn('accounts.port')}><input type="text" className="gnosi-input" value={mailSmtpPort} onChange={e => { setMailSmtpPort(e.target.value); }} placeholder="465" /></FormGroup>
      </div>
      <FormGroup label={tn('accounts.user')}><input type="text" className="gnosi-input" value={mailSmtpUser} onChange={e => { setMailSmtpUser(e.target.value); }} name="smtp-username" autoComplete="username" /></FormGroup>
      <FormGroup label={tn('accounts.password')}><PasswordInput value={mailSmtpPass} onChange={e => { setMailSmtpPass(e.target.value); }} name="smtp-password" autoComplete="current-password" /></FormGroup>
      <FormGroup label={tn('accounts.security')}>
        <select className="gnosi-select" value={mailSmtpEnc} onChange={e => { setMailSmtpEnc(e.target.value); }}>
          <option value="ssl">SSL/TLS</option>
          <option value="starttls">STARTTLS</option>
          <option value="none">{tn('accounts.security_none')}</option>
        </select>
      </FormGroup>
    </div>

    <div style={{ gridColumn: 'span 2' }}>
      <FormGroup label={tn('accounts.signature_label')} description={tn('accounts.signature_desc')}>
        <div style={{ marginTop: '8px' }}>
          <MailBlockEditor
            key={editingAccountId || 'new'}
            initialContent={mailSignature}
            onChange={setMailSignature}
            minHeight="120px"
          />
        </div>
      </FormGroup>
    </div>
    <div style={{ gridColumn: 'span 2' }}>
      <FormGroup label={tn('accounts.certificate_label')}>
        <input type="text" className="gnosi-input" value={mailCertificate} onChange={e => { setMailCertificate(e.target.value); }} placeholder={t('settings.accounts.certificate_placeholder', '/ruta/al/certificat.crt')} />
      </FormGroup>
    </div>

    <div style={{ gridColumn: 'span 2', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
        {editingAccountId
          ? tn('accounts.identity_autosave_hint')
          : tn('accounts.fill_and_connect')}
      </div>
      <button
        type="submit"
        className="btn-gnosi-primary"
        style={{ padding: '12px 24px', fontSize: '0.9rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '8px' }}
        disabled={mailTestStatus === 'testing'}
      >
        {mailTestStatus === 'testing' && <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />}
        {mailTestStatus === 'ok' && <Check size={15} />}
        {editingAccountId
          ? (mailTestStatus === 'ok' ? tn('accounts.connection_ok') : mailTestStatus === 'error' ? tn('accounts.connection_error') : tn('accounts.test_connection'))
          : tn('accounts.connect_account')}
      </button>
    </div>
  </form>);
}
