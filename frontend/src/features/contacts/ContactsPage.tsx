import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Users } from 'lucide-react';

import { AppHeader } from '../../components/AppHeader';
import ConfirmModal from '../../components/ConfirmModal';
import ContactDetail from './components/ContactDetail';
import ContactForm from './components/ContactForm';
import ContactList from './components/ContactList';
import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import type {
  Contact,
  ContactQuery,
  ContactWriteInput,
} from '../../shared/api/contacts';
import {
  useContacts,
  useCreateContact,
  useDeleteContact,
  useUpdateContact,
} from '../../shared/api/useContactsData';
import { useIntegrations } from '../../shared/api/useIntegrationsData';
import {
  buildContactIntegrationCatalog,
} from './contactIntegrationCatalog';


interface DeleteContactState {
  readonly contactId: string | null;
  readonly isOpen: boolean;
}


function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === 'string' && error ? error : 'Unknown error';
}


/** Coordinate the contact master list, details, and editor panes. */
export default function ContactsPage() {
  const { t } = useTranslation();
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [filter, setFilter] = useState<ContactQuery>({ search: '', type: '' });
  const [deleteModal, setDeleteModal] = useState<DeleteContactState>({
    contactId: null,
    isOpen: false,
  });
  const contactsQuery = useContacts(filter);
  const integrationsQuery = useIntegrations();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();
  const integrationCatalog = useMemo(
    () => buildContactIntegrationCatalog(integrationsQuery.data),
    [integrationsQuery.data],
  );
  const contacts = contactsQuery.data ?? [];
  const hasActivePane = isEditing || selectedContact !== null;

  useEffect(() => {
    if (!contactsQuery.error) return;
    logError('contacts-load', contactsQuery.error);
    toast.error(t('contacts.load_error', 'Could not load contacts'));
  }, [contactsQuery.error, t]);

  useEffect(() => {
    if (integrationsQuery.error) {
      logError('contacts-integrations-load', integrationsQuery.error);
    }
  }, [integrationsQuery.error]);

  const handleSelectContact = (contact: Contact): void => {
    setSelectedContact(contact);
    setIsEditing(false);
    setIsCreating(false);
  };

  const handleCreateNew = (): void => {
    setSelectedContact(null);
    setIsCreating(true);
    setIsEditing(true);
  };

  const handleCancel = (): void => {
    setIsEditing(false);
    setIsCreating(false);
  };

  const handleSave = async (formData: ContactWriteInput): Promise<void> => {
    try {
      if (isCreating) {
        await createContact.mutateAsync(formData);
      } else if (selectedContact) {
        const saved = await updateContact.mutateAsync({
          contactId: selectedContact.id,
          input: formData,
        });
        setSelectedContact(saved);
      }
      setIsEditing(false);
      setIsCreating(false);
    } catch (error: unknown) {
      logError('contacts-save', error);
      toast.error(t('contacts.save_error', 'Could not save the contact'));
    }
  };

  const executeDelete = async (): Promise<void> => {
    const contactId = deleteModal.contactId;
    if (!contactId) return;
    try {
      await deleteContact.mutateAsync(contactId);
      setSelectedContact(null);
      setDeleteModal({ contactId: null, isOpen: false });
    } catch (error: unknown) {
      logError('contacts-delete', error);
      toast.error(
        `${t('errors.delete_contact', 'Error deleting the contact: ')}${describeError(error)}`,
      );
    }
  };

  return (
    <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
      <AppHeader icon={Users} title={t('contacts.title', 'Contacts')}>
        <button
          type="button"
          onClick={handleCreateNew}
          className="flex items-center gap-1.5 h-7 px-3 bg-[var(--gnosi-action-bg)] hover:opacity-90 text-white rounded-md border-none font-bold text-[11px] uppercase tracking-tight cursor-pointer transition-all shadow-sm"
        >
          <Plus size={14} />
          {t('contacts.new_contact', 'New Contact')}
        </button>
      </AppHeader>

      <div className="contacts-split">
        <div className={`contacts-master ${hasActivePane ? 'contacts-master--inactive' : ''}`}>
          <div className="flex-1 overflow-hidden">
            <ContactList
              contacts={contacts}
              selectedId={selectedContact?.id}
              onSelect={handleSelectContact}
              filter={filter}
              onFilterChange={setFilter}
              loading={contactsQuery.isFetching}
            />
          </div>
        </div>

        <div className={`contacts-detail-pane ${hasActivePane ? 'contacts-detail-pane--active' : ''}`}>
          {isEditing
            ? (
                <ContactForm
                  contact={isCreating ? null : selectedContact}
                  onSave={handleSave}
                  onCancel={handleCancel}
                  onBack={handleCancel}
                  contactAccounts={integrationCatalog.accounts}
                />
              )
            : selectedContact
              ? (
                  <ContactDetail
                    contact={selectedContact}
                    onEdit={() => {
                      setIsEditing(true);
                    }}
                    onDelete={(contactId: string) => {
                      setDeleteModal({ contactId, isOpen: true });
                    }}
                    onBack={() => {
                      setSelectedContact(null);
                    }}
                  />
                )
              : (
                  <div className="h-full flex items-center justify-center p-10 text-center">
                    <div>
                      <div className="mb-4 inline-flex p-6 rounded-full border border-dashed border-[var(--border-primary)]">
                        <Users size={48} strokeWidth={1} className="text-[var(--text-secondary)]" />
                      </div>
                      <p className="text-base text-[var(--text-secondary)]">
                        {t(
                          'contacts.select_hint',
                          'Select a contact to view details',
                        )}
                      </p>
                    </div>
                  </div>
                )}
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => {
          setDeleteModal({ contactId: null, isOpen: false });
        }}
        onConfirm={executeDelete}
        title={t('common.confirm_delete_records', 'Delete Records')}
        message={t(
          'common.confirm_delete',
          'Are you sure you want to delete this record? This action cannot be undone.',
        )}
        confirmText={t('common.delete', 'Delete')}
        cancelText={t('common.cancel', 'Cancel')}
      />
    </div>
  );
}
