import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import PostCard from './PostCard';

const Column = ({ title, icon, posts = [], onDelete, onRefresh }) => {
    return (
        <div className="min-w-[360px] max-w-[400px] glass-card rounded-xl flex flex-col h-full shrink-0 overflow-hidden shadow-2xl shadow-black/20">
            <div className="p-4 border-b border-white/5 font-semibold text-zinc-100 flex justify-between items-center bg-white/5 bg-opacity-50 backdrop-blur-md relative z-10">
                <div className="flex items-center gap-3">
                    <span className="text-xl">{icon}</span>
                    <span className="tracking-wide">{title}</span>
                    <span className="bg-white/10 text-xs px-2 py-0.5 rounded-full text-zinc-400">{posts.length}</span>
                </div>

                <div className="relative group">
                    <button className="text-zinc-500 hover:text-zinc-300 hover:bg-white/5 p-1 rounded-lg transition-colors">
                        <MoreHorizontal size={20} />
                    </button>

                    {/* Dropdown Menu */}
                    <div className="absolute right-0 top-full mt-1 w-32 bg-[#18181b] border border-white/10 rounded-xl shadow-xl overflow-hidden hidden group-hover:block animate-in fade-in zoom-in-95 duration-100">
                        <button
                            onClick={onRefresh}
                            className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                        >
                            Refresh
                        </button>
                        <button
                            onClick={onDelete}
                            className="w-full text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                        >
                            Delete
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 p-3 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 hover:scrollbar-thumb-zinc-600 space-y-4">
                {posts.length > 0 ? (
                    posts.map((post) => (
                        <PostCard key={post.id} post={post} />
                    ))
                ) : (
                    <div className="flex flex-col items-center justify-center text-zinc-500 mt-20 gap-2">
                        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-2">
                            <span className="text-2xl opacity-50">{icon}</span>
                        </div>
                        <p>No hi ha posts recents</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Column;
