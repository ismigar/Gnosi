import type { CSSProperties } from 'react';

interface MailServerPreset { host: string; port: string; enc: string }

import type { SettingsController } from './useGlobalSettingsController';
type Props = { context: Pick<SettingsController, 'activeTab' | 'addAccountEmail' | 'addAccountEmailBlurred' | 'isManualGoogle' | 'setMailImapEnc' | 'setMailImapHost' | 'setMailImapPort' | 'setMailImapUser' | 'setMailSmtpEnc' | 'setMailSmtpHost' | 'setMailSmtpPort' | 'setMailSmtpUser' | 'tn'> };

export function AccountProviderChoices({ context }: Props) {
  const { activeTab, addAccountEmail, addAccountEmailBlurred, isManualGoogle, setMailImapEnc, setMailImapHost, setMailImapPort, setMailImapUser, setMailSmtpEnc, setMailSmtpHost, setMailSmtpPort, setMailSmtpUser, tn } = context;
  return ((() => {
    const emailLower = addAccountEmail.trim().toLowerCase();
    const isComplete = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower);
    if (!isComplete || (!addAccountEmailBlurred && !isManualGoogle)) return null;

    const isGoogle = emailLower.endsWith('@gmail.com') || emailLower.endsWith('@googlemail.com') || isManualGoogle;
    const isMicrosoft = emailLower.endsWith('@outlook.com') || emailLower.endsWith('@hotmail.com') || emailLower.endsWith('@live.com') || emailLower.endsWith('@msn.com');
    const isICloud = emailLower.endsWith('@icloud.com') || emailLower.endsWith('@me.com') || emailLower.endsWith('@mac.com');
    const isYahoo = emailLower.endsWith('@yahoo.com') || emailLower.endsWith('@ymail.com') || emailLower.endsWith('@yahoo.es');
    const isAol = emailLower.endsWith('@aol.com');

    const fillImap = (imap: MailServerPreset, smtp: MailServerPreset) => {
      setMailImapHost(imap.host); setMailImapPort(imap.port); setMailImapEnc(imap.enc);
      setMailSmtpHost(smtp.host); setMailSmtpPort(smtp.port); setMailSmtpEnc(smtp.enc);
      setMailImapUser(addAccountEmail); setMailSmtpUser(addAccountEmail);
    };

    const btnStyle = (bg: string, shadow: string): CSSProperties => ({
      width: '100%', background: bg, padding: '14px 16px',
      borderRadius: '14px', fontWeight: '800', display: 'flex',
      alignItems: 'center', gap: '12px',
      boxShadow: shadow, border: 'none', cursor: 'pointer',
      transition: 'all 0.2s', color: 'white', fontSize: '0.95rem'
    });
    const iconBox = (r?: string): CSSProperties => ({ background: 'white', padding: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: r || '10px' });

    const GoogleBtn = () => (
      <button onClick={() => window.location.href = `/api/auth/google/login?type=${activeTab}`} style={btnStyle('#4285f4', '0 8px 16px rgba(66,133,244,0.25)')}>
        <div style={iconBox()}><img src="https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png" style={{ width: '18px', height: '18px' }} alt="" /></div>
        {tn('accounts.continue_with', { provider: 'Google' })}
      </button>
    );
    const MicrosoftBtn = () => (
      <button onClick={() => window.location.href = '/api/auth/microsoft/login'} style={btnStyle('#0078d4', '0 8px 16px rgba(0,120,212,0.25)')}>
        <div style={iconBox()}><svg width="18" height="18" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" /><rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" /></svg></div>
        {tn('accounts.continue_with', { provider: 'Microsoft' })}
      </button>
    );
    const ICloudBtn = () => (
      <button onClick={() => { fillImap({ host: 'imap.mail.me.com', port: '993', enc: 'ssl' }, { host: 'smtp.mail.me.com', port: '587', enc: 'starttls' }); }} style={btnStyle('#555', '0 8px 16px rgba(0,0,0,0.15)')}>
        <div style={iconBox('8px')}><svg width="18" height="18" viewBox="0 0 24 24" fill="#555"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" /></svg></div>
        {tn('accounts.continue_with', { provider: 'iCloud' })}
      </button>
    );
    const YahooBtn = () => (
      <button onClick={() => { fillImap({ host: 'imap.mail.yahoo.com', port: '993', enc: 'ssl' }, { host: 'smtp.mail.yahoo.com', port: '465', enc: 'ssl' }); }} style={btnStyle('#6001d2', '0 8px 16px rgba(96,1,210,0.2)')}>
        <div style={iconBox()}><svg width="18" height="18" viewBox="0 0 24 24" fill="#6001d2"><path d="M14.2 2.9L12 9.3 9.8 2.9H6L10.6 14v7.1h2.8V14L18 2.9zM19.6 9.5l-2 5.7-2.1-5.7h-2.8l3.5 9-.1.2c-.4.9-.8 1.2-1.6 1.2-.3 0-.7-.1-1-.2l-.3 2.2c.5.2 1.1.3 1.7.3 2 0 3-.9 3.9-3.4l3.3-9.3h-2.5z" /></svg></div>
        {tn('accounts.continue_with', { provider: 'Yahoo' })}
      </button>
    );
    const AolBtn = () => (
      <button onClick={() => { fillImap({ host: 'imap.aol.com', port: '993', enc: 'ssl' }, { host: 'smtp.aol.com', port: '465', enc: 'ssl' }); }} style={btnStyle('#ff0b00', '0 8px 16px rgba(255,11,0,0.2)')}>
        <div style={iconBox()}><svg width="18" height="18" viewBox="0 0 24 24" fill="#ff0b00"><text x="0" y="16" fontSize="14" fontWeight="bold">AOL</text></svg></div>
        {tn('accounts.continue_with', { provider: 'AOL' })}
      </button>
    );

    // Domain clearly identified → single button
    if (isGoogle) return <div className="animate-in" style={{ marginTop: '8px' }}><GoogleBtn /></div>;
    if (isMicrosoft) return <div className="animate-in" style={{ marginTop: '8px' }}><MicrosoftBtn /></div>;
    if (isICloud) return <div className="animate-in" style={{ marginTop: '8px' }}><ICloudBtn /></div>;
    if (isYahoo) return <div className="animate-in" style={{ marginTop: '8px' }}><YahooBtn /></div>;
    if (isAol) return <div className="animate-in" style={{ marginTop: '8px' }}><AolBtn /></div>;

    // Unknown domain → show all options
    return (
      <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', margin: '0 0 4px', textAlign: 'center' }}>{tn('accounts.select_provider')}</p>
        <GoogleBtn />
        <MicrosoftBtn />
        <ICloudBtn />
        <YahooBtn />
        <AolBtn />
        <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textAlign: 'center', margin: '4px 0 0' }}>
          {tn('accounts.manual_below')}
        </p>
      </div>
    );
  })());
}
