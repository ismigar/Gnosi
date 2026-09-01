import { configurableGap } from './settingsStyles';
import { AccountRow } from './AccountRow';
import { Calendar } from 'lucide-react';
import { InlineEditorPlacement } from '../../../shared/ui/settings/SettingsPrimitives';
import { Mail } from 'lucide-react';
import React from 'react';
import { Users } from 'lucide-react';
import { bulkUpdateIntegrations } from '../../../shared/api/integrations';
import { setMailAccountEnabled } from '../../../shared/api/mail';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'activeTab' | 'addAccountType' | 'calendarAuthErrors' | 'contactsSyncErrors' | 'editingAccountId' | 'editingTableColor' | 'handleDeleteAccount' | 'handleEditAccount' | 'handleSyncAccount' | 'integrations' | 'isAddingTable' | 'setAccountEditorTarget' | 'setEditingTableColor' | 'setIntegrations' | 'setTableColorEditorTarget' | 'syncErrorAccounts' | 'syncingAccounts' | 't' | 'tableColorEditorTarget' | 'tables' | 'tn'> };

export function AccountList({ context }: Props) {
  const { activeTab, addAccountType, calendarAuthErrors, contactsSyncErrors, editingAccountId, editingTableColor, handleDeleteAccount, handleEditAccount, handleSyncAccount, integrations, isAddingTable, setAccountEditorTarget, setEditingTableColor, setIntegrations, setTableColorEditorTarget, syncErrorAccounts, syncingAccounts, t, tableColorEditorTarget, tables, tn } = context;
  return ((() => {
    // Get all possible accounts that could be mail accounts
    const currentAccounts = [
      ...(integrations.mail_accounts || []),
      ...(integrations.emails || []),
      ...(integrations.calendars || []),
      ...(integrations.contacts || [])
    ].filter(acc => acc.email || acc.username);

    // Deduplicate by Email/ID
    const seen = new Set();
    const uniqueAccounts = currentAccounts.filter(acc => {
      const email = acc.email || acc.username;
      if (!email) return false;
      const lowerEmail = email.toLowerCase();
      if (seen.has(lowerEmail)) return false;
      seen.add(lowerEmail);
      return true;
    });

    const vaultCalendars = activeTab === 'calendar' ? (tables.filter(t => integrations.vault_calendar?.enabled_tables?.includes(t.id))) : [];
    const hasAny = (uniqueAccounts.length > 0) || (vaultCalendars.length > 0);

    if (hasAny) {
      return (
        <div className="settings-configurable-list" style={{ ...configurableGap('12px') }}>
          {/* External Accounts / Integrations */}
          {uniqueAccounts.map((acc, idx) => {
            const accountItemId = acc.id || acc.email || acc.username || `account-${String(idx)}`;
            return (
              <React.Fragment key={`acc-${accountItemId}`}>
                <AccountRow
                  itemId={`account:${accountItemId}`}
                  name={acc.name || acc.email}
                  description={acc.username || acc.email}
                  status={(activeTab === 'calendar' ? calendarAuthErrors : activeTab === 'contacts' ? contactsSyncErrors : syncErrorAccounts).has(acc.email || acc.username || '') ? 'error' : 'connected'}
                  type={activeTab}
                  provider={acc.provider}
                  enabled={acc.enabled !== false}
                  onToggleEnabled={activeTab === 'mail' ? async (val) => {
                    const emailAddr = acc.email || acc.username || '';
                    await setMailAccountEnabled(emailAddr, val);
                    setIntegrations(prev => {
                      const updated = { ...prev };
                      for (const section of ['mail_accounts', 'emails'] as const) {
                        if (updated[section]) {
                          updated[section] = updated[section].map(a =>
                            (a.email || a.username) === emailAddr ? { ...a, enabled: val } : a
                          );
                        }
                      }
                      return updated;
                    });
                  } : undefined}
                  onSync={() => handleSyncAccount(activeTab, acc)}
                  isSyncing={syncingAccounts[acc.id ?? 'undefined']}
                  isEditing={editingAccountId === acc.id}
                  onEdit={() => { handleEditAccount(activeTab, acc); }}
                  onDelete={() => { handleDeleteAccount(activeTab, acc.id); }}
                  color={activeTab === 'calendar' ? '#3b82f6' : (activeTab === 'contacts' ? '#10b981' : '#f59e0b')}
                />
                {editingAccountId === acc.id && (
                  <div
                    ref={setAccountEditorTarget}
                    data-settings-editor-anchor-for={`account:${accountItemId}`}
                  />
                )}
              </React.Fragment>
            );
          })}

          {/* Vault tables (Calendar only) */}
          {vaultCalendars.map((tbl, idx) => {
            const tblColor = integrations.calendar_colors?.[tbl.id] || integrations.calendar_colors?.[tbl.name] || '#6366f1';
            return (
              <React.Fragment key={`vault-${tbl.id || String(idx)}`}>
                <AccountRow
                  itemId={`vault-calendar:${tbl.id}`}
                  name={tbl.name}
                  description={tn('accounts.vault_table')}
                  status="connected"
                  type="calendar"
                  provider="vault"
                  isEditing={editingTableColor?.id === tbl.id}
                  onEdit={() => { setEditingTableColor({ id: tbl.id, name: tbl.name, color: tblColor }); }}
                  onDelete={() => {
                    const newList = integrations.vault_calendar?.enabled_tables?.filter(id => id !== tbl.id) || [];
                    const updated = { ...integrations, vault_calendar: { ...integrations.vault_calendar, enabled_tables: newList } };
                    setIntegrations(updated);
                    bulkUpdateIntegrations(updated).catch(console.error);
                  }}
                  color={tblColor}
                />
                {editingTableColor?.id === tbl.id && (
                  <div
                    ref={setTableColorEditorTarget}
                    data-settings-editor-anchor-for={`vault-calendar:${tbl.id}`}
                  />
                )}
              </React.Fragment>
            );
          })}

          {/* Inline color editor for the selected vault calendar */}
          {editingTableColor && (
            <InlineEditorPlacement
              target={tableColorEditorTarget}
              waitForTarget
            >
              <div
                className="settings-inline-editor is-attached animate-in"
                data-settings-editor-for={`vault-calendar:${editingTableColor.id}`}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '25px' }}>
                  {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#6366f1', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#71717a'].map(c => (
                    <button
                      key={c}
                      onClick={() => { setEditingTableColor({ ...editingTableColor, color: c }); }}
                      style={{
                        height: '40px', borderRadius: '10px', border: editingTableColor.color === c ? '3px solid var(--text-primary)' : 'none',
                        background: c, cursor: 'pointer'
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => {
                      const updatedColors = { ...(integrations.calendar_colors || {}), [editingTableColor.id]: editingTableColor.color };
                      const updated = { ...integrations, calendar_colors: updatedColors };
                      setIntegrations(updated);
                      bulkUpdateIntegrations(updated).catch(console.error);
                      setEditingTableColor(null);
                    }}
                    className="btn-gnosi-primary" style={{ flex: 1, padding: '12px' }}
                  >{t('common.save')}</button>
                  <button onClick={() => { setEditingTableColor(null); }} className="btn-gnosi-secondary" style={{ flex: 1, padding: '12px' }}>{t('common.cancel')}</button>
                </div>
              </div>
            </InlineEditorPlacement>
          )}
        </div>
      );
    } else {
      return !addAccountType && !isAddingTable && (
        <div style={{ textAlign: 'center', padding: '100px 40px', background: 'var(--settings-sidebar-bg)', borderRadius: '28px', border: '2px dashed var(--settings-border)', opacity: 0.6 }}>
          <div style={{ width: '80px', height: '80px', background: 'var(--settings-bg)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 28px auto', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
            {activeTab === 'calendar' ? <Calendar size={40} strokeWidth={1.5} /> : (activeTab === 'contacts' ? <Users size={40} strokeWidth={1.5} /> : <Mail size={40} strokeWidth={1.5} />)}
          </div>
          <div style={{ fontWeight: '900', fontSize: '1.3rem', color: 'var(--text-primary)' }}>{tn('accounts.no_accounts')}</div>
          <p style={{ fontSize: '0.95rem', marginTop: '12px', maxWidth: '300px', margin: '12px auto 0' }}>{tn('accounts.no_accounts_hint')}</p>
        </div>
      );
    }
  })());
}
