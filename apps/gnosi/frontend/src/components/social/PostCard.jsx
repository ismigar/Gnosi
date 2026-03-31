import React, { useState } from 'react';
import { Heart, Repeat, MessageCircle, Share, ExternalLink } from 'lucide-react';

const PostCard = ({ post, onInteraction }) => {
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
        if (net === 'mastodon') return 'text-purple-400';
        if (net === 'bluesky') return 'text-blue-400';
        if (net === 'linkedin') return 'text-blue-600';
        return 'text-zinc-400';
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
        <div
            className="group bg-surface/40 hover:bg-surface/60 border border-white/5 rounded-xl p-4 transition-all duration-200 hover:shadow-lg hover:shadow-black/20 cursor-pointer backdrop-blur-sm"
            onClick={openPost}
        >
            {/* Reblog indicator */}
            {is_reblog && reblog_by && (
                <div className="text-xs text-zinc-500 mb-2 flex items-center gap-1.5 font-medium ml-10">
                    <Repeat size={12} />
                    <span>{reblog_by} boosted</span>
                </div>
            )}

            <div className="flex gap-3">
                {/* Avatar */}
                <div className="shrink-0 pt-1">
                    <div className="w-10 h-10 rounded-full bg-white/10 overflow-hidden ring-2 ring-white/5 group-hover:ring-white/10 transition-all">
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
                                <span className="font-semibold text-zinc-200 truncate hover:underline decoration-white/20">{author}</span>
                                <span className={`text-[10px] uppercase font-bold tracking-wider ${getNetworkColor(network)} bg-white/5 px-1.5 py-0.5 rounded ml-1`}>
                                    {network}
                                </span>
                            </div>
                            <div className="text-xs text-zinc-500 truncate">{handle}</div>
                        </div>
                        <span className="text-xs text-zinc-600 shrink-0 whitespace-nowrap hover:text-zinc-400">
                            {new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>

                    {/* Post Text */}
                    <p className="text-zinc-300 text-[15px] leading-relaxed mb-3 whitespace-pre-wrap break-words font-light">
                        {content}
                    </p>

                    {/* Footer Actions */}
                    {network !== 'scheduled' && (
                        <div className="flex justify-between items-center text-zinc-500 max-w-[80%]">
                            <button className="flex items-center gap-1.5 hover:text-blue-400 p-1.5 -ml-1.5 rounded-full hover:bg-blue-500/10 transition-all group/btn" onClick={(e) => { e.stopPropagation(); openPost(); }}>
                                <MessageCircle size={16} />
                                <span className="text-xs">{replies_count || 0}</span>
                            </button>

                            <button
                                className={`flex items-center gap-1.5 p-1.5 rounded-full hover:bg-green-500/10 transition-all ${reposted ? 'text-green-500' : 'hover:text-green-500'}`}
                                onClick={handleRepost}
                                disabled={loading.repost}
                            >
                                <Repeat size={16} />
                                <span className="text-xs">{repostCount}</span>
                            </button>

                            <button
                                className={`flex items-center gap-1.5 p-1.5 rounded-full hover:bg-red-500/10 transition-all ${liked ? 'text-red-500' : 'hover:text-red-400'}`}
                                onClick={handleLike}
                                disabled={loading.like}
                            >
                                <Heart size={16} fill={liked ? "currentColor" : "none"} />
                                <span className={`text-xs ${liked ? 'font-medium' : ''}`}>{likeCount}</span>
                            </button>

                            <button className="flex items-center gap-1.5 hover:text-blue-400 p-1.5 rounded-full hover:bg-blue-500/10 transition-all" onClick={(e) => { e.stopPropagation(); openPost(); }}>
                                <Share size={16} />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PostCard;
