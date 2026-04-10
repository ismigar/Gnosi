import React, { useState, useEffect } from 'react';
import ContactList from '../components/Contacts/ContactList';
import ContactDetail from '../components/Contacts/ContactDetail';
import ContactForm from '../components/Contacts/ContactForm';
import SyncStatusBadge from '../components/Contacts/SyncStatusBadge';
import { useApi } from '../hooks/use-api';

export default function ContactsPage() {
    const { apiPost, apiGet } = useApi();
    const [contacts, setContacts] = useState([]);
    const [selectedContact, setSelectedContact] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [syncStatus, setSyncStatus] = useState(null);
    const [filter, setFilter] = useState({ type: '', search: '' });
    const [loading, setLoading] = useState(false);

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

    const loadSyncStatus = async () => {
        try {
            const status = await apiGet('/api/contacts/sync/status');
            setSyncStatus(status);
        } catch (error) {
            console.error('Error loading sync status:', error);
        }
    };

    useEffect(() => {
        loadContacts();
        loadSyncStatus();
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
        if (selectedContact) {
            loadContacts();
        }
    };

    const handleSave = async (formData) => {
        try {
            if (isCreating) {
                await apiPost('/api/contacts', formData);
            } else if (selectedContact) {
                await apiPost(`/api/contacts/${selectedContact.id}`, formData);
            }
            setIsEditing(false);
            setIsCreating(false);
            await loadContacts();
            await loadSyncStatus();
        } catch (error) {
            console.error('Error saving contact:', error);
        }
    };

    const handleDelete = async (contactId) => {
        if (!confirm('Are you sure you want to delete this contact?')) return;
        try {
            await apiPost(`/api/contacts/${contactId}`, {}, 'DELETE');
            setSelectedContact(null);
            await loadContacts();
            await loadSyncStatus();
        } catch (error) {
            console.error('Error deleting contact:', error);
        }
    };

    const handleSync = async () => {
        try {
            await apiPost('/api/contacts/sync', {});
            await loadContacts();
            await loadSyncStatus();
        } catch (error) {
            console.error('Error syncing contacts:', error);
        }
    };

    return (
        <div className="h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
            <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
                <h1 className="text-2xl font-bold">Contacts</h1>
                <div className="flex items-center gap-4">
                    {syncStatus && <SyncStatusBadge status={syncStatus} />}
                    <button
                        onClick={handleSync}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Sync with Google
                    </button>
                    <button
                        onClick={handleCreateNew}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                        New Contact
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <ContactList
                    contacts={contacts}
                    selectedId={selectedContact?.id}
                    onSelect={handleSelectContact}
                    filter={filter}
                    onFilterChange={setFilter}
                    loading={loading}
                />

                <div className="flex-1 overflow-y-auto">
                    {isEditing ? (
                        <ContactForm
                            contact={isCreating ? null : selectedContact}
                            onSave={handleSave}
                            onCancel={handleCancel}
                        />
                    ) : selectedContact ? (
                        <ContactDetail
                            contact={selectedContact}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                        />
                    ) : (
                        <div className="h-full flex items-center justify-center text-[var(--text-secondary)]">
                            <p>Select a contact or create a new one</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
