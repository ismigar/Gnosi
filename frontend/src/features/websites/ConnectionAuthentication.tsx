import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TargetConnection } from '../../shared/api/sites';
import { Field, Input, Select } from './components';

const FilesystemPickerModal = lazy(() => import('../../shared/ui/filesystem-picker/FilesystemPickerModal').then(module => ({ default: module.FilesystemPickerModal })));

export function ConnectionAuthentication({ value, disabled, canSave, update, savePassword }: {
  value: TargetConnection;
  disabled: boolean;
  canSave: boolean;
  update: (value: Partial<TargetConnection>) => void;
  savePassword: (password: string | null) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [pickingKey, setPickingKey] = useState(false);
  const authentication = value.authentication;
  return <section className="websites-spacer">
    <div className="websites-grid"><Field label={t('websites.sshAuthentication')}><Select disabled={disabled} value={authentication} onChange={event => { update({ authentication: event.target.value as TargetConnection['authentication'] }); }}>
      <option value="agent">{t('websites.sshAgent')}</option><option value="key">{t('websites.sshIdentity')}</option><option value="password">{t('websites.sshPassword')}</option>
    </Select></Field><Field label={t('websites.transferProtocol')}><Select disabled={disabled} value={value.transfer_protocol} onChange={event => { update({ transfer_protocol: event.target.value as TargetConnection['transfer_protocol'] }); }}><option value="ssh">SSH</option><option value="sftp">SFTP</option></Select></Field>
      {authentication === 'key' && <Field label={t('websites.sshIdentityFile')} help={t('websites.sshIdentityHelp')}><Input value={value.identity_file} disabled={disabled} onChange={event => { update({ identity_file: event.target.value }); }} autoComplete="off" /><button type="button" className="websites-button" disabled={disabled} onClick={() => { setPickingKey(true); }}>{t('websites.chooseFile')}</button></Field>}
      {authentication === 'password' && <Field label={t('websites.sshPassword')} help={t(value.password_configured ? 'websites.passwordStored' : 'websites.sshPasswordHelp')}><Input type="password" value={password} disabled={disabled} onChange={event => { setPassword(event.target.value); }} autoComplete="new-password" maxLength={4096} /></Field>}
    </div>
    {authentication === 'password' && <div className="websites-actions websites-spacer"><button type="button" className="websites-button" disabled={disabled || !canSave || !password} onClick={() => { void savePassword(password).then(saved => { if (saved) setPassword(''); }); }}>{t('websites.saveConnectionPassword')}</button><button type="button" className="websites-button" disabled={disabled || !canSave || !value.password_configured} onClick={() => { void savePassword(null); }}>{t('websites.clearConnectionPassword')}</button></div>}
    {pickingKey && <Suspense fallback={<span role="status">{t('websites.loading')}</span>}><FilesystemPickerModal isOpen={pickingKey} mode="file" initialPath={value.identity_file || '/'} onClose={() => { setPickingKey(false); }} onSelect={path => { update({ identity_file: path }); setPickingKey(false); }} /></Suspense>}
    <p className="websites-muted websites-spacer">{t('websites.sshRequirements')}</p>
  </section>;
}
