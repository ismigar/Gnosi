import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../hooks/use-api';
import { Users, Plus } from 'lucide-react';
import ContactList from '../components/Contacts/ContactList';
import ContactDetail from '../components/Contacts/ContactDetail';
import ContactForm from '../components/Contacts/ContactForm';
import { AppHeader } from '../components/AppHeader';
import ConfirmModal from '../components/ConfirmModal';

export default function ContactsPage() {
    const { t } = useTranslation();
    const { apiPost, apiGet } = useApi();
    const [contacts, setContacts] = useState([]);
    const [selectedContact, setSelectedContact] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [filter, setFilter] = useState({ type: '', search: '' });
    const [loading, setLoading] = useState(false);
    const [deleteModal, setDeleteModal] = useState({ isOpen: false, contactId: null });
    const [contactAccounts, setContactAccounts] = useState([]);
    const [defaultContactAccount, setDefaultContactAccount] = useState(null);

    const loadContacts = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filter.type) params.append('type', filter.type);
            if (filter.search) params.append('search', filter.search);
            
            const url = `/api/contacts${params.toString() ? '?' + params.toString() : ''}`;
            const data = await apiGet(url);
            setContacts(data);
        } catch (error) {
            console.error('Error loading contacts:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadIntegrations = async () => {
        try {
            const data = await apiGet('/api/integrations');
            if (data && data.contacts) {
                setContactAccounts(data.contacts);
            }
        } catch (error) {
            console.error('Error loading integrations:', error);
        }
    };

    useEffect(() => {
        loadContacts();
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
                await apiPost('/api/contacts', formData);
            } else if (selectedContact) {
                await apiPost(`/api/contacts/${selectedContact.id}`, formData, 'PUT');
            }
            setIsEditing(false);
            setIsCreating(false);
            await loadContacts();
        } catch (error) {
            console.error('Error saving contact:', error);
        }
    };

    const handleDelete = (contactId) => {
        setDeleteModal({ isOpen: true, contactId });
    };

    const executeDelete = async () => {
        const { contactId } = deleteModal;
        if (!contactId) return;

        try {
            await apiPost(`/api/contacts/${contactId}`, {}, 'DELETE');
            setSelectedContact(null);
            await loadContacts();
            setDeleteModal({ isOpen: false, contactId: null });
        } catch (error) {
            console.error('Error deleting contact:', error);
            alert(t('errors.delete_contact', 'Error al eliminar el contacte: ') + error.message);
        }
    };

    return (
        <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
            <AppHeader icon={Users} title={t('contacts.title', 'Contactes')}>
                <button
                    onClick={handleCreateNew}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        height: '28px',
                        padding: '0 12px',
                        background: 'var(--gnosi-blue)',
                        color: 'white',
                        borderRadius: '6px',
                        border: 'none',
                        fontWeight: '700',
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)'
                    }}
                >
                    <Plus size={14} />
                    {t('contacts.new_contact', 'Nou Contacte')}
                </button>
            </AppHeader>

            <div className="gnosi-page__content" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '380px', borderRight: '1px solid var(--border-color)' }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
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

                <div className="gnosi-page__detail" style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-primary)' }}>
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
                        />
                    ) : (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
                            <div style={{ opacity: 0.5 }}>
                                <div style={{ marginBottom: '16px', display: 'inline-flex', padding: '24px', borderRadius: '50%', background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--border-color)' }}>
                                    <Users size={48} strokeWidth={1} />
                                </div>
                                <p style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                                    {t('contacts.select_hint', 'Selecciona un contacte per veure\'n els detalls')}
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
                title={t('common.confirm_delete_records', 'Eliminar registre')}
                message={t('common.confirm_delete', 'Estàs segur que vols eliminar aquest registre? Aquesta acció no es pot desfer.')}
                confirmText={t('common.delete', 'Eliminar')}
                cancelText={t('common.cancel', 'Cancel·lar')}
            />
        </div>
    );
}
