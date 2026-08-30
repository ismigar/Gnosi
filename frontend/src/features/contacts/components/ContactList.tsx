import { useTranslation } from 'react-i18next';
import { CheckCircle2, Filter, Search } from 'lucide-react';

import type { Contact, ContactQuery } from '../../../shared/api/contacts';
import { getGoogleAvatarUrl, isGmail } from '../model/avatar-utils';


export interface ContactListProps {
  readonly contacts: readonly Contact[];
  readonly filter: ContactQuery;
  readonly loading?: boolean;
  readonly onFilterChange: (filter: ContactQuery) => void;
  readonly onSelect: (contact: Contact) => void;
  readonly selectedId?: string;
}


/** Render contact filters and the selectable master list. */
export default function ContactList({
  contacts,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  loading = false,
}: ContactListProps) {
  const { t } = useTranslation();

  return (
    <div
      className="contact-list"
      style={{
        background: 'var(--bg-primary)',
        borderRight: '1px solid var(--border-primary)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        className="contact-list__filters"
        style={{
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '12px 16px',
        }}
      >
        <div style={{ alignItems: 'center', display: 'flex', position: 'relative' }}>
          <Search
            size={14}
            style={{
              color: 'var(--text-tertiary)',
              left: '10px',
              opacity: 0.6,
              position: 'absolute',
            }}
          />
          <input
            type="text"
            placeholder={t('contacts.search_placeholder', 'Search contacts...')}
            value={filter.search ?? ''}
            onChange={(event) => {
              onFilterChange({ ...filter, search: event.target.value });
            }}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none',
              padding: '6px 10px 6px 32px',
              transition: 'all 0.2s',
              width: '100%',
            }}
          />
        </div>
        <div style={{ alignItems: 'center', display: 'flex', position: 'relative' }}>
          <Filter
            size={12}
            style={{
              color: 'var(--text-tertiary)',
              left: '10px',
              opacity: 0.6,
              position: 'absolute',
            }}
          />
          <select
            value={filter.type ?? ''}
            onChange={(event) => {
              onFilterChange({ ...filter, type: event.target.value });
            }}
            aria-label={t('contacts.filter_type', 'Filter contacts by type')}
            style={{
              appearance: 'none',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '12px',
              outline: 'none',
              padding: '6px 10px 6px 32px',
              width: '100%',
            }}
          >
            <option value="">{t('contacts.filter_all', 'All')}</option>
            <option value="personal">{t('contacts.type_personal', 'Personal')}</option>
            <option value="b2b">{t('contacts.type_business', 'Business')}</option>
          </select>
        </div>
      </div>

      <div
        className="contact-list__items"
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: '2px',
          overflowY: 'auto',
          padding: '8px',
        }}
      >
        {loading
          ? (
              <div style={{ color: 'var(--text-tertiary)', padding: '32px 16px', textAlign: 'center' }}>
                <div className="animate-spin" style={{ display: 'inline-block', marginBottom: '8px' }}>
                  <Filter size={20} opacity={0.3} />
                </div>
                <p style={{ fontSize: '12px' }}>{t('common.status.loading')}</p>
              </div>
            )
          : contacts.length === 0
            ? (
                <div style={{ padding: '48px 16px', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    {t('contacts.no_contacts', "You don't have any contacts yet.")}
                  </p>
                </div>
              )
            : contacts.map((contact) => {
                const googleAvatar = isGmail(contact.email)
                  ? getGoogleAvatarUrl(contact.email)
                  : '';
                const avatarUrl = contact.photo_url || googleAvatar;
                const selected = selectedId === contact.id;
                return (
                  <button
                    type="button"
                    key={contact.id}
                    onClick={() => {
                      onSelect(contact);
                    }}
                    style={{
                      alignItems: 'center',
                      background: selected ? 'var(--bg-secondary)' : 'transparent',
                      border: '1px solid',
                      borderColor: selected ? 'var(--border-primary)' : 'transparent',
                      borderRadius: '6px',
                      color: 'inherit',
                      cursor: 'pointer',
                      display: 'flex',
                      gap: '10px',
                      padding: '8px 12px',
                      position: 'relative',
                      textAlign: 'left',
                      transition: 'all 0.1s ease',
                      width: '100%',
                    }}
                    onMouseEnter={(event) => {
                      if (!selected) {
                        event.currentTarget.style.background = 'var(--bg-secondary)';
                        event.currentTarget.style.opacity = '0.8';
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!selected) {
                        event.currentTarget.style.background = 'transparent';
                        event.currentTarget.style.opacity = '1';
                      }
                    }}
                  >
                    <div
                      style={{
                        alignItems: 'center',
                        background: avatarUrl ? 'transparent' : 'var(--gnosi-blue)',
                        borderRadius: '8px',
                        color: avatarUrl ? 'inherit' : 'white',
                        display: 'flex',
                        flexShrink: 0,
                        fontSize: '14px',
                        fontWeight: '700',
                        height: '32px',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        width: '32px',
                      }}
                    >
                      {avatarUrl && (
                        <img
                          src={avatarUrl}
                          alt={contact.name}
                          style={{ height: '100%', objectFit: 'cover', width: '100%' }}
                          onError={(event) => {
                            const image = event.currentTarget;
                            image.style.display = 'none';
                            const fallback = image.nextElementSibling;
                            if (fallback instanceof HTMLElement) fallback.style.display = 'block';
                            if (image.parentElement) {
                              image.parentElement.style.background = 'var(--gnosi-blue)';
                              image.parentElement.style.color = 'white';
                            }
                          }}
                        />
                      )}
                      <div style={{ display: avatarUrl ? 'none' : 'block', textAlign: 'center', width: '100%' }}>
                        {(contact.name || '?').charAt(0).toUpperCase()}
                      </div>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ alignItems: 'center', display: 'flex', gap: '6px' }}>
                        <p
                          style={{
                            color: 'var(--text-primary)',
                            fontSize: '13px',
                            fontWeight: selected ? '600' : '500',
                            margin: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {contact.name}
                        </p>
                        {contact.google_resource_name && (
                          <CheckCircle2 size={10} style={{ color: '#4285f4', opacity: 0.8 }} />
                        )}
                      </div>
                      <p
                        style={{
                          color: 'var(--text-tertiary)',
                          fontSize: '11px',
                          margin: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {contact.company || contact.email}
                      </p>
                    </div>

                    {selected && (
                      <div
                        style={{
                          background: 'var(--gnosi-blue)',
                          borderRadius: '1px',
                          height: '16px',
                          left: '0px',
                          position: 'absolute',
                          width: '2px',
                        }}
                      />
                    )}
                  </button>
                );
              })}
      </div>
    </div>
  );
}
