import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import Column from '../components/social/Column';
import Composer from '../components/social/Composer';
import { SocialLayout } from '../components/social/SocialLayout';
import AddStreamModal from '../components/social/AddStreamModal';

const DEFAULT_STREAMS = [
    { id: "mastodon-home", title: "Mastodon Home", icon: "🐘", network: "mastodon" },
    { id: "bluesky-home", title: "Bluesky Home", icon: "🦋", network: "bluesky" },
    { id: "scheduled", title: "Scheduled", icon: "📅", network: "scheduled" },
];

const SocialDashboard = () => {
    const [showComposer, setShowComposer] = useState(false);
    const [showAddStream, setShowAddStream] = useState(false);

    // Initialize columns from localStorage or defaults
    const [columns, setColumns] = useState(() => {
        const saved = localStorage.getItem('social_dashboard_streams');
        return saved ? JSON.parse(saved) : DEFAULT_STREAMS;
    });

    // State to store fetched posts for each column
    const [streamData, setStreamData] = useState({});
    const [loading, setLoading] = useState(true);

    // Save columns to localStorage whenever they change
    useEffect(() => {
        localStorage.setItem('social_dashboard_streams', JSON.stringify(columns));
    }, [columns]);

    // Fetch feed for a specific stream
    const fetchStreamFeed = async (stream) => {
        try {
            const res = await fetch(`/api/social/feed/${stream.id}`);
            const data = res.ok ? await res.json() : [];
            setStreamData(prev => ({
                ...prev,
                [stream.id]: data
            }));
        } catch (error) {
            console.error(`Error loading stream ${stream.id}:`, error);
        }
    };

    // Initial fetch for all columns
    useEffect(() => {
        const fetchAll = async () => {
            setLoading(true);
            await Promise.all(columns.map(col => fetchStreamFeed(col)));
            setLoading(false);
        };
        fetchAll();
    }, [columns]); // Re-fetch when columns change (e.g. added new one)

    const handleAddStream = (newStream) => {
        setColumns(prev => [...prev, newStream]);
    };

    const handleDeleteStream = (streamId) => {
        setColumns(prev => prev.filter(col => col.id !== streamId));
        // Also clean up data
        setStreamData(prev => {
            const newData = { ...prev };
            delete newData[streamId];
            return newData;
        });
    };

    const handleRefreshStream = (streamId) => {
        const stream = columns.find(c => c.id === streamId);
        if (stream) {
            // Set loading state for this specific stream if we wanted (UI improvement)
            // For now just fetch
            fetchStreamFeed(stream);
        }
    };

    const ActionButton = (
        <button
            onClick={() => setShowComposer(!showComposer)}
            className="flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition-all shadow-lg shadow-primary/20 text-sm font-medium"
        >
            <Plus size={18} />
            <span>{showComposer ? 'Close Composer' : 'New Post'}</span>
        </button>
    );

    return (
        <SocialLayout title="Dashboard" action={ActionButton}>
            {/* Add Stream Modal */}
            <AddStreamModal
                isOpen={showAddStream}
                onClose={() => setShowAddStream(false)}
                onAdd={handleAddStream}
            />

            {showComposer && (
                <div className="mb-6 animate-in slide-in-from-top-4 duration-300 fade-in">
                    <div className="max-w-2xl mx-auto">
                        <Composer />
                    </div>
                </div>
            )}

            <div className="h-full">
                {loading && Object.keys(streamData).length === 0 ? (
                    <div className="flex justify-center items-center h-64 text-zinc-500 animate-pulse">Loading streams...</div>
                ) : (
                    <div className="flex gap-6 h-full pb-4 overflow-x-auto snap-x">
                        {columns.map(col => (
                            <Column
                                key={col.id}
                                id={col.id}
                                title={col.title}
                                icon={col.icon}
                                posts={streamData[col.id] || []}
                                onDelete={() => handleDeleteStream(col.id)}
                                onRefresh={() => handleRefreshStream(col.id)}
                            />
                        ))}

                        {/* Add Column Button */}
                        <button
                            onClick={() => setShowAddStream(true)}
                            className="min-w-[320px] h-full border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center text-zinc-500 hover:text-zinc-300 hover:border-white/20 hover:bg-white/5 transition-all gap-2 group shrink-0"
                        >
                            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                                <Plus size={24} />
                            </div>
                            <span className="font-medium">Add Stream</span>
                        </button>
                    </div>
                )}
            </div>
        </SocialLayout>
    );
};

export default SocialDashboard;
