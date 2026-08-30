import type { MailAlias } from './types';
import MailBlockEditor from '../../mail/editor/Mail/MailBlockEditor';
import React from 'react';
import { useTranslation } from 'react-i18next';

export const AliasEditor = ({ aliases, onChange }: { aliases: MailAlias[]; onChange: (aliases: MailAlias[]) => void }) => {
  const { t } = useTranslation();
  const [expandedIdx, setExpandedIdx] = React.useState<number | null>(null);
  const update = (i: number, patch: Partial<MailAlias>) => {
    const updated = [...aliases];
    const alias = updated[i];
    if (!alias) return;
    updated[i] = { ...alias, ...patch };
    onChange(updated);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {aliases.map((alias, i) => (
        <div key={i} style={{ border: '1px solid var(--settings-border)', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '6px 8px' }}>
            <input
              type="email"
              className="gnosi-input"
              style={{ flex: 2 }}
              value={alias.email}
              placeholder={t('settings.accounts.alias_email_placeholder')}
              onChange={e => { update(i, { email: e.target.value }); }}
            />
            <input
              type="text"
              className="gnosi-input"
              style={{ flex: 2 }}
              value={alias.display_name || ''}
              placeholder={t('settings.accounts.alias_name_placeholder')}
              onChange={e => { update(i, { display_name: e.target.value }); }}
            />
            <button
              type="button"
              title={t('settings.accounts.signature')}
              onClick={() => { setExpandedIdx(expandedIdx === i ? null : i); }}
              style={{ padding: '6px 8px', border: '1px solid var(--settings-border)', borderRadius: '6px', background: expandedIdx === i ? 'var(--gnosi-blue)' : 'transparent', color: expandedIdx === i ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700' }}
            >
              {t('settings.accounts.sig_abbr')}
            </button>
            <button
              type="button"
              onClick={() => { onChange(aliases.filter((_, j) => j !== i)); if (expandedIdx === i) setExpandedIdx(null); }}
              style={{ padding: '6px', border: 'none', background: 'transparent', color: 'var(--status-error)', cursor: 'pointer', borderRadius: '6px' }}
            >✕</button>
          </div>
          {expandedIdx === i && (
            <div style={{ padding: '8px', borderTop: '1px solid var(--settings-border)', background: 'var(--settings-sidebar-bg)' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: '800', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                {t('settings.accounts.alias_signature')}
              </label>
              <MailBlockEditor
                initialContent={alias.signature || ''}
                onChange={html => { update(i, { signature: html }); }}
                minHeight="80px"
              />
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => { onChange([...aliases, { email: '', display_name: '', signature: '' }]); }}
        style={{ alignSelf: 'flex-start', padding: '4px 12px', fontSize: '0.78rem', border: '1px dashed var(--settings-border)', borderRadius: '8px', background: 'transparent', color: 'var(--gnosi-blue)', cursor: 'pointer', fontWeight: '700' }}
      >
        {t('settings.accounts.add_alias')}
      </button>
    </div>
  );
};
