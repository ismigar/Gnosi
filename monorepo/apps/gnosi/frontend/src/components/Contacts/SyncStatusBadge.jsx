import React from 'react';

export default function SyncStatusBadge({ status }) {
    if (!status) return null;

    const syncPercentage = status.contacts_count > 0
        ? Math.round((status.google_synced_count / status.contacts_count) * 100)
        : 0;

    return (
        <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--text-secondary)]">
                {status.google_synced_count}/{status.contacts_count} synced
            </span>
            <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                    className="h-full bg-green-500 transition-all duration-300"
                    style={{ width: `${syncPercentage}%` }}
                />
            </div>
            {status.last_sync_at && (
                <span className="text-[var(--text-secondary)] text-xs">
                    Last: {new Date(status.last_sync_at).toLocaleDateString()}
                </span>
            )}
        </div>
    );
}
