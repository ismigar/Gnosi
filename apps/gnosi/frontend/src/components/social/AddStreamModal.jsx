import React, { useState } from 'react';
import { X, Check, Rss, Bell, Globe, Search, Hash } from 'lucide-react';

const NETWORKS = [
    { id: 'mastodon', name: 'Mastodon', icon: '🐘', color: 'bg-purple-500/20 text-purple-200' },
    { id: 'bluesky', name: 'Bluesky', icon: '🦋', color: 'bg-blue-500/20 text-blue-200' },
    { id: 'linkedin', name: 'LinkedIn', icon: '💼', color: 'bg-blue-700/20 text-blue-200' },
    { id: 'facebook', name: 'Facebook', icon: '📘', color: 'bg-blue-600/20 text-blue-200' },
    { id: 'telegram', name: 'Telegram', icon: '✈️', color: 'bg-sky-500/20 text-sky-200' }
];

const STREAM_TYPES = [
    { id: 'home', label: 'Home Timeline', icon: Rss, description: 'Following feed' },
    { id: 'my-posts', label: 'My Published History', icon: Rss, description: 'Posts sent via this app' },
    { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Mentions and interactions' },
    { id: 'public', label: 'Public / Federated', icon: Globe, description: 'Global activity' },
    { id: 'tag', label: 'Hashtag', icon: Hash, description: 'Track specific tags' },
];

const AddStreamModal = ({ isOpen, onClose, onAdd }) => {
    const [selectedNetwork, setSelectedNetwork] = useState(NETWORKS[0]);
    const [selectedType, setSelectedType] = useState(STREAM_TYPES[0]);
    const [streamName, setStreamName] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();

        // Construct the stream object
        // ID format: network-type[-extra]
        // Example: mastodon-home, bluesky-tag-python
        const streamId = `${selectedNetwork.id}-${selectedType.id}` + (streamName ? `-${streamName.toLowerCase().replace(/\s+/g, '-')}` : '');

        const newStream = {
            id: streamId,
            title: streamName || `${selectedNetwork.name} ${selectedType.label}`,
            icon: selectedNetwork.icon,
            network: selectedNetwork.id,
            type: selectedType.id
        };

        onAdd(newStream);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-md bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/5">
                    <h2 className="text-xl font-semibold text-white">Add New Stream</h2>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Network Selection */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Network</label>
                        <div className="grid grid-cols-2 gap-3">
                            {NETWORKS.map(net => (
                                <button
                                    key={net.id}
                                    type="button"
                                    onClick={() => setSelectedNetwork(net)}
                                    className={`
                                        flex items-center gap-3 p-3 rounded-xl border transition-all text-left
                                        ${selectedNetwork.id === net.id
                                            ? 'bg-primary/10 border-primary/50 text-white shadow-[0_0_15px_rgba(59,130,246,0.15)]'
                                            : 'bg-white/5 border-transparent text-zinc-400 hover:bg-white/10 hover:text-zinc-200'}
                                    `}
                                >
                                    <span className="text-xl">{net.icon}</span>
                                    <span className="font-medium">{net.name}</span>
                                    {selectedNetwork.id === net.id && <Check size={16} className="ml-auto text-primary" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Stream Type Selection */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Stream Type</label>
                        <div className="grid grid-cols-1 gap-2">
                            {STREAM_TYPES.filter(type => {
                                // Filter logic:
                                // 'home' only for Mastodon/Bluesky
                                // 'my-posts' only for FB/LinkedIn/Telegram

                                const isRestricted = ['facebook', 'linkedin', 'telegram'].includes(selectedNetwork.id);

                                if (type.id === 'home' && isRestricted) return false;
                                if (type.id === 'my-posts' && !isRestricted) return false;

                                return true;
                            }).map(type => (
                                <button
                                    key={type.id}
                                    type="button"
                                    onClick={() => setSelectedType(type)}
                                    className={`
                                        flex items-center gap-4 p-3 rounded-xl border transition-all text-left group
                                        ${selectedType.id === type.id
                                            ? 'bg-white/10 border-white/20 text-white'
                                            : 'bg-transparent border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}
                                    `}
                                >
                                    <div className={`
                                        p-2 rounded-lg transition-colors
                                        ${selectedType.id === type.id ? 'bg-primary text-white' : 'bg-white/5 text-zinc-500 group-hover:text-zinc-300'}
                                    `}>
                                        <type.icon size={18} />
                                    </div>
                                    <div>
                                        <div className="font-medium">{type.label}</div>
                                        <div className="text-xs text-zinc-500">{type.description}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Optional Custom Name (future proofing) */}
                    {/* <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-400">Custom Name (Optional)</label>
                        <input 
                            type="text" 
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-zinc-600 focus:outline-none focus:border-primary/50 transition-colors"
                            placeholder="e.g. My Favorite Feed"
                            value={streamName}
                            onChange={(e) => setStreamName(e.target.value)}
                        />
                    </div> */}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        className="w-full bg-primary hover:bg-blue-600 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 mt-4"
                    >
                        <Plus size={20} />
                        Add Stream
                    </button>
                </form>
            </div>
        </div>
    );
};

// Helper for the "Plus" icon in button if not imported
const Plus = ({ size = 24, className = "" }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M5 12h14" />
        <path d="M12 5v14" />
    </svg>
);

export default AddStreamModal;
