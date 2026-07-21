import React from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import PostCard from './PostCard';

const Column = ({ title, icon, posts = [], onDelete, onRefresh }) => {
    const { t } = useTranslation();
    return (
        <div className="min-w-[360px] max-w-[400px] glass-card rounded-xl flex flex-col h-full shrink-0 overflow-hidden shadow-2xl shadow-black/20">
            <div className="p-4 border-b border-[var(--border-primary)] font-semibold text-[var(--text-primary)] flex justify-between items-center bg-[var(--bg-secondary)]/50 backdrop-blur-md relative z-10">
                <div className="flex items-center gap-3">
                    <span className="text-xl">{icon}</span>
                    <span className="tracking-wide">{title}</span>
                    <span className="bg-[var(--bg-tertiary)] text-xs px-2 py-0.5 rounded-full text-[var(--text-secondary)]">{posts.length}</span>
                </div>

                <div className="relative group">
                    <button className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] p-1 rounded-lg transition-colors">
                        <MoreHorizontal size={20} />
                    </button>

                    {/* Dropdown Menu */}
                    <div className="absolute right-0 top-full mt-1 w-32 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl shadow-xl overflow-hidden hidden group-hover:block animate-in fade-in zoom-in-95 duration-100">
                        <button
                            onClick={onRefresh}
                            className="w-full text-left px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                        >
                            Refresh
                        </button>
                        <button
                            onClick={onDelete}
                            className="w-full text-left px-4 py-2 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            Delete
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 p-3 overflow-y-auto scrollbar-thin space-y-4">
                {posts.length > 0 ? (
                    posts.map((post) => (
                        <PostCard key={post.id} post={post} />
                    ))
                ) : (
                    <div className="flex flex-col items-center justify-center text-[var(--text-secondary)] mt-20 gap-2">
                        <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mb-2">
                            <span className="text-2xl opacity-50">{icon}</span>
                        </div>
                        <p>{t('social.column_empty', 'No hi ha posts recents')}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Column;
