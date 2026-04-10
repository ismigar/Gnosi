import React from 'react';

export default function ContactList({ contacts, selectedId, onSelect, filter, onFilterChange, loading }) {
    return (
        <div className="w-80 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-secondary)]">
            <div className="p-4 border-b border-[var(--border-color)] space-y-3">
                <input
                    type="text"
                    placeholder="Search contacts..."
                    value={filter.search}
                    onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                    value={filter.type}
                    onChange={(e) => onFilterChange({ ...filter, type: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="">All types</option>
                    <option value="personal">Personal</option>
                    <option value="b2b">Business</option>
                </select>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="p-4 text-center text-[var(--text-secondary)]">Loading...</div>
                ) : contacts.length === 0 ? (
                    <div className="p-4 text-center text-[var(--text-secondary)]">No contacts found</div>
                ) : (
                    <ul className="divide-y divide-[var(--border-color)]">
                        {contacts.map((contact) => (
                            <li
                                key={contact.id}
                                onClick={() => onSelect(contact)}
                                className={`p-4 cursor-pointer hover:bg-[var(--bg-primary)] transition-colors ${
                                    selectedId === contact.id ? 'bg-[var(--bg-primary)]' : ''
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold">
                                        {contact.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{contact.name}</p>
                                        <p className="text-sm text-[var(--text-secondary)] truncate">{contact.email}</p>
                                        {contact.company && (
                                            <p className="text-xs text-[var(--text-secondary)] truncate">{contact.company}</p>
                                        )}
                                    </div>
                                    {contact.google_resource_name && (
                                        <span className="w-2 h-2 rounded-full bg-green-500" title="Synced with Google" />
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
