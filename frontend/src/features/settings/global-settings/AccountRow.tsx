import type { SettingsTranslate } from './types';

interface AccountRowProps { itemId?: string; name?: string; description?: string; status: string; type: string; provider?: string; onSync?: () => void | Promise<void>; onEdit?: () => void; onDelete?: () => void; onToggleEnabled?: (enabled: boolean) => void | Promise<void>; enabled?: boolean; isSyncing?: boolean; isEditing?: boolean; color?: string }
import { Calendar } from 'lucide-react';
import { Eye } from 'lucide-react';
import { EyeOff } from 'lucide-react';
import { Mail } from 'lucide-react';
import { RefreshCw } from 'lucide-react';
import { Settings as SettingsIcon } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const AccountRow = ({ itemId, name, description, status, type, provider, onSync, onEdit, onDelete, onToggleEnabled, enabled = true, isSyncing = false, isEditing = false }: AccountRowProps) => {
  const { t } = useTranslation();
  const ta: SettingsTranslate = (k, opts) => t('settings.accounts.' + k, opts);
  return (
    <div className={`account-row settings-configurable-item hover-scale ${isEditing ? 'is-editing' : ''}`} data-settings-item-id={itemId} style={{
      padding: '18px 24px', border: '1px solid var(--settings-border)',
      background: 'var(--settings-sidebar-bg)', display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      opacity: enabled ? 1 : 0.5
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'rgba(59, 130, 246, 0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gnosi-blue)' }}>
          {type === 'calendar' ? <Calendar size={22} /> : (type === 'mail' ? <Mail size={22} /> : <Users size={22} />)}
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontWeight: '800', fontSize: '1.05rem', color: 'var(--text-primary)' }}>{name || description}</div>
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', opacity: 0.8 }}>{(name && name !== description) ? description : (provider === 'manual' ? ta('manual_config') : ta('connected_account'))}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '10px' }}>
          {enabled && (
            <span style={{
              fontSize: '0.68rem', padding: '5px 14px', borderRadius: '20px',
              background: status === 'connected' ? 'rgba(16, 185, 129, 0.12)' : status === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
              color: status === 'connected' ? 'var(--status-success)' : status === 'error' ? 'var(--status-error)' : 'var(--status-warning)', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '0.04em'
            }}>
              {status === 'connected' ? ta('status_connected') : status === 'error' ? ta('status_error') : ta('status_pending')}
            </span>
          )}
          {enabled && (
            <button
              onClick={(e) => { e.stopPropagation(); void (onSync && onSync()); }}
              disabled={isSyncing}
              className="icon-btn hover-bg"
              title={ta('sync_tip')}
              style={{ padding: '8px', borderRadius: '10px', color: 'var(--gnosi-blue)' }}
            >
              <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); void (onToggleEnabled && onToggleEnabled(!enabled)); }}
          className="icon-btn hover-bg"
          title={enabled ? ta('disable_account') : ta('enable_account')}
          style={{ padding: '8px', borderRadius: '10px', color: enabled ? 'var(--text-secondary)' : 'var(--gnosi-blue)' }}
        >
          {enabled ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button onClick={onEdit} aria-label={ta('edit_account')} title={ta('edit_account')} className="icon-btn hover-bg" style={{ padding: '8px', borderRadius: '10px' }}><SettingsIcon size={18} /></button>
        <button onClick={onDelete} aria-label={ta('delete_account')} title={ta('delete_account')} className="icon-btn hover-bg-danger" style={{ color: 'var(--status-error)', padding: '8px', borderRadius: '10px' }}><Trash2 size={18} /></button>
      </div>
    </div>
  );
};
