import React, { useState } from 'react';
import { Heart, Repeat, MessageCircle, Share } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const PostCard = ({ post }) => {
    const { t } = useTranslation();
    const {
        id, author, handle, content, timestamp, network, avatar,
        is_reblog, reblog_by, favourited, reblogged,
        favourites_count, reblogs_count, replies_count, url, cid
    } = post;

    const [liked, setLiked] = useState(favourited);
    const [reposted, setReposted] = useState(reblogged);
    const [likeCount, setLikeCount] = useState(favourites_count || 0);
    const [repostCount, setRepostCount] = useState(reblogs_count || 0);
    const [loading, setLoading] = useState({ like: false, repost: false });

    // Use specific colors for networks (simulated with standard classes for now)
    const getNetworkColor = (net) => {
        if (net === 'mastodon') return 'text-purple-700 dark:text-purple-300';
        if (net === 'bluesky') return 'text-blue-700 dark:text-blue-300';
        if (net === 'linkedin') return 'text-blue-700 dark:text-blue-300';
        return 'text-[var(--text-secondary)]';
    };

    const handleLike = async (e) => {
        e.stopPropagation();
        if (network === 'scheduled') return;
        setLoading(prev => ({ ...prev, like: true }));

        try {
            const action = liked ? 'unlike' : 'like';
            const res = await fetch('/api/social/interact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ post_id: id, network, action, cid })
            });

            if (res.ok) {
                setLiked(!liked);
                setLikeCount(prev => liked ? prev - 1 : prev + 1);
            }
        } catch (e) {
            console.error('Like failed:', e);
        } finally {
            setLoading(prev => ({ ...prev, like: false }));
        }
    };

    const handleRepost = async (e) => {
        e.stopPropagation();
        if (network === 'scheduled') return;
        setLoading(prev => ({ ...prev, repost: true }));

        try {
            const action = reposted ? 'unreblog' : 'reblog';
            const res = await fetch('/api/social/interact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ post_id: id, network, action, cid })
            });

            if (res.ok) {
                setReposted(!reposted);
                setRepostCount(prev => reposted ? prev - 1 : prev + 1);
            }
        } catch (e) {
            console.error('Repost failed:', e);
        } finally {
            setLoading(prev => ({ ...prev, repost: false }));
        }
    };

    const openPost = () => {
        if (url) window.open(url, '_blank');
    };

    return (
        <article
            data-testid="post-card"
            className="group cursor-pointer rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4 transition-all duration-200 hover:bg-[var(--bg-secondary)] hover:shadow-md"
            onClick={openPost}
        >
            {/* Reblog indicator */}
            {is_reblog && reblog_by && (
                <div className="mb-2 ml-10 flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)]">
                    <Repeat size={12} />
                    <span>{t('social.boosted_by', '{{name}} boosted', { name: reblog_by })}</span>
                </div>
            )}

            <div className="flex gap-3">
                {/* Avatar */}
                <div className="shrink-0 pt-1">
                    <div className="h-10 w-10 overflow-hidden rounded-full bg-[var(--bg-tertiary)] ring-2 ring-[var(--border-primary)] transition-all">
                        {avatar ? (
                            <img src={avatar} alt={author} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-lg">👤</div>
                        )}
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex justify-between items-start mb-1">
                        <div className="truncate pr-2">
                            <div className="flex items-center gap-2">
                                <span className="truncate font-semibold text-[var(--text-primary)] hover:underline">{author}</span>
                                <span className={`ml-1 rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getNetworkColor(network)}`}>
                                    {network}
                                </span>
                            </div>
                            <div className="truncate text-xs text-[var(--text-tertiary)]">{handle}</div>
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-xs text-[var(--text-tertiary)]">
                            {new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>

                    {/* Post Text */}
                    <p className="mb-3 whitespace-pre-wrap break-words text-[15px] font-normal leading-relaxed text-[var(--text-primary)]">
                        {content}
                    </p>

                    {/* Footer Actions */}
                    {network !== 'scheduled' && (
                        <div className="flex max-w-[80%] items-center justify-between text-[var(--text-tertiary)]">
                            <button aria-label={t('social.open_post', 'Open post')} className="group/btn -ml-1.5 flex items-center gap-1.5 rounded-full p-1.5 transition-all hover:bg-blue-500/10 hover:text-blue-500" onClick={(e) => { e.stopPropagation(); openPost(); }}>
                                <MessageCircle size={16} />
                                <span className="text-xs">{replies_count || 0}</span>
                            </button>

                            <button
                                aria-label={t('social.repost', 'Repost')}
                                className={`flex items-center gap-1.5 p-1.5 rounded-full hover:bg-green-500/10 transition-all ${reposted ? 'text-green-500' : 'hover:text-green-500'}`}
                                onClick={handleRepost}
                                disabled={loading.repost}
                            >
                                <Repeat size={16} />
                                <span className="text-xs">{repostCount}</span>
                            </button>

                            <button
                                aria-label={t('social.like', 'Like')}
                                className={`flex items-center gap-1.5 p-1.5 rounded-full hover:bg-red-500/10 transition-all ${liked ? 'text-red-500' : 'hover:text-red-400'}`}
                                onClick={handleLike}
                                disabled={loading.like}
                            >
                                <Heart size={16} fill={liked ? "currentColor" : "none"} />
                                <span className={`text-xs ${liked ? 'font-medium' : ''}`}>{likeCount}</span>
                            </button>

                            <button aria-label={t('social.share_post', 'Share post')} className="flex items-center gap-1.5 rounded-full p-1.5 transition-all hover:bg-blue-500/10 hover:text-blue-500" onClick={(e) => { e.stopPropagation(); openPost(); }}>
                                <Share size={16} />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
};

export default PostCard;
