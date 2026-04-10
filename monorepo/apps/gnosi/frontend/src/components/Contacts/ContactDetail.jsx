import React from 'react';

export default function ContactDetail({ contact, onEdit, onDelete }) {
    if (!contact) return null;

    return (
        <div className="p-6">
            <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-semibold">
                        {contact.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold">{contact.name}</h2>
                        <p className="text-[var(--text-secondary)]">
                            {contact.type === 'b2b' ? contact.job_title : 'Personal Contact'}
                            {contact.company && ` at ${contact.company}`}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={onEdit}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Edit
                    </button>
                    <button
                        onClick={() => onDelete(contact.id)}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    >
                        Delete
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase mb-1">Email</h3>
                        <p>{contact.email}</p>
                    </div>
                    {contact.phone && (
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase mb-1">Phone</h3>
                            <p>{contact.phone}</p>
                        </div>
                    )}
                    {contact.address && (
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase mb-1">Address</h3>
                            <p>{contact.address}</p>
                        </div>
                    )}
                </div>

                {contact.type === 'b2b' && (
                    <div className="space-y-4">
                        {contact.company && (
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase mb-1">Company</h3>
                                <p>{contact.company}</p>
                            </div>
                        )}
                        {contact.job_title && (
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase mb-1">Job Title</h3>
                                <p>{contact.job_title}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {contact.notes && (
                <div className="mt-6">
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase mb-1">Notes</h3>
                    <p className="whitespace-pre-wrap">{contact.notes}</p>
                </div>
            )}

            {contact.tags && contact.tags.length > 0 && (
                <div className="mt-6">
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase mb-1">Tags</h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {contact.tags.map((tag, index) => (
                            <span
                                key={index}
                                className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-sm"
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-6 pt-6 border-t border-[var(--border-color)] text-sm text-[var(--text-secondary)]">
                <div className="flex gap-4">
                    <span>Source: {contact.source}</span>
                    {contact.last_synced_at && (
                        <span>Last synced: {new Date(contact.last_synced_at).toLocaleString()}</span>
                    )}
                </div>
            </div>
        </div>
    );
}
