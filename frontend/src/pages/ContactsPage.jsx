import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../hooks/use-api';
import { Users, Plus } from 'lucide-react';
import ContactList from '../components/Contacts/ContactList';
import ContactDetail from '../components/Contacts/ContactDetail';
import ContactForm from '../components/Contacts/ContactForm';
import { AppHeader } from '../components/AppHeader';
import ConfirmModal from '../components/ConfirmModal';
import { toast } from '../lib/toast';
import {
    createContact,
    deleteContact,
    updateContact,
} from '../shared/api/contacts';
import { useContacts } from '../shared/api/useContactsData';

export default function ContactsPage() {
    const { t } = useTranslation();
    const { apiGet } = useApi();
    const [selectedContact, setSelectedContact] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [filter, setFilter] = useState({ type: '', search: '' });
    const [deleteModal, setDeleteModal] = useState({ isOpen: false, contactId: null });
    const [contactAccounts, setContactAccounts] = useState([]);
    const [defaultContactAccount, setDefaultContactAccount] = useState(null);
    const hasActivePane = isEditing || Boolean(selectedContact);
    const contactsQuery = useContacts(filter);
    const contacts = contactsQuery.data || [];
    const loading = contactsQuery.isFetching;

    useEffect(() => {
        if (!contactsQuery.error) return;
        console.error('Error loading contacts:', contactsQuery.error);
        toast.error(t('contacts.load_error', 'Could not load contacts'));
    }, [contactsQuery.error, t]);

    const loadIntegrations = async () => {
        try {
            const data = await apiGet('/api/integrations');
            if (data) {
                setContactAccounts(data.contacts || []);
                const defaultEmail = data.default_contacts;
                if (defaultEmail) {
                    const allAccounts = [...(data.contacts || []), ...(data.mail_accounts || []), ...(data.emails || [])];
                    const acc = allAccounts.find(a => (a.email || a.username) === defaultEmail);
                    if (acc) setDefaultContactAccount(acc);
                }
            }
        } catch (error) {
            console.error('Error loading integrations:', error);
        }
    };

    useEffect(() => {
        loadIntegrations();
    }, [filter]);

    const handleSelectContact = (contact) => {
        setSelectedContact(contact);
        setIsEditing(false);
        setIsCreating(false);
    };

    const handleCreateNew = () => {
        setSelectedContact(null);
        setIsCreating(true);
        setIsEditing(true);
    };

    const handleEdit = () => {
        setIsEditing(true);
    };

    const handleCancel = () => {
        setIsEditing(false);
        setIsCreating(false);
    };

    const handleSave = async (formData) => {
        try {
            if (isCreating) {
                await createContact(formData);
            } else if (selectedContact) {
                await updateContact(selectedContact.id, formData);
            }
            setIsEditing(false);
            setIsCreating(false);
            await contactsQuery.refetch();
        } catch (error) {
            console.error('Error saving contact:', error);
            toast.error(t('contacts.save_error', 'Could not save the contact'));
        }
    };

    const handleDelete = (contactId) => {
        setDeleteModal({ isOpen: true, contactId });
    };

    const executeDelete = async () => {
        const { contactId } = deleteModal;
        if (!contactId) return;

        try {
            await deleteContact(contactId);
            setSelectedContact(null);
            await contactsQuery.refetch();
            setDeleteModal({ isOpen: false, contactId: null });
        } catch (error) {
            console.error('Error deleting contact:', error);
            toast.error(t('errors.delete_contact', "Error deleting the contact: ") + error.message);
        }
    };

    return (
        <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
            <AppHeader icon={Users} title={t('contacts.title', "Contacts")}>
                <button
                    onClick={handleCreateNew}
                    className="flex items-center gap-1.5 h-7 px-3 bg-[var(--gnosi-action-bg)] hover:opacity-90 text-white rounded-md border-none font-bold text-[11px] uppercase tracking-tight cursor-pointer transition-all shadow-sm"
                >
                    <Plus size={14} />
                    {t('contacts.new_contact', "New Contact")}
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
                            loading={loading}
                        />
                    </div>
                </div>

                <div className={`contacts-detail-pane ${hasActivePane ? 'contacts-detail-pane--active' : ''}`}>
                    {isEditing ? (
                        <ContactForm
                            contact={isCreating ? null : selectedContact}
                            onSave={handleSave}
                            onCancel={handleCancel}
                            onBack={handleCancel}
                            contactAccounts={contactAccounts}
                            defaultAccount={defaultContactAccount}
                        />
                    ) : selectedContact ? (
                        <ContactDetail
                            contact={selectedContact}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onBack={() => setSelectedContact(null)}
                        />
                    ) : (
                        <div className="h-full flex items-center justify-center p-10 text-center">
                            <div>
                                <div className="mb-4 inline-flex p-6 rounded-full border border-dashed border-[var(--border-primary)]">
                                    <Users size={48} strokeWidth={1} className="text-[var(--text-secondary)]" />
                                </div>
                                <p className="text-base text-[var(--text-secondary)]">
                                    {t('contacts.select_hint', "Select a contact to view details")}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            <ConfirmModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, contactId: null })}
                onConfirm={executeDelete}
                title={t('common.confirm_delete_records', "Delete Records")}
                message={t('common.confirm_delete', "Are you sure you want to delete this record? This action cannot be undone.")}
                confirmText={t('common.delete', "Delete")}
                cancelText={t('common.cancel', "Cancel")}
            />
        </div>
    );
}
