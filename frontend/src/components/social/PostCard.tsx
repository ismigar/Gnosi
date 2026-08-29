import { useState, type MouseEvent } from 'react';
import { Heart, MessageCircle, Repeat, Share } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  interactSocialPost,
  type SocialPost,
} from '../../shared/api/social';


export interface PostCardProps {
  readonly post: SocialPost;
}


interface InteractionLoading {
  readonly like: boolean;
  readonly repost: boolean;
}


function networkColor(network: string): string {
  if (network === 'mastodon') return 'text-purple-700 dark:text-purple-300';
  if (network === 'bluesky' || network === 'linkedin') {
    return 'text-blue-700 dark:text-blue-300';
  }
  return 'text-[var(--text-secondary)]';
}


export default function PostCard({ post }: PostCardProps) {
  const { t } = useTranslation();
  const [liked, setLiked] = useState(post.favourited);
  const [reposted, setReposted] = useState(post.reblogged);
  const [likeCount, setLikeCount] = useState(post.favourites_count);
  const [repostCount, setRepostCount] = useState(post.reblogs_count);
  const [loading, setLoading] = useState<InteractionLoading>({
    like: false,
    repost: false,
  });

  const handleLike = async (event: MouseEvent<HTMLButtonElement>): Promise<void> => {
    event.stopPropagation();
    if (post.network === 'scheduled') return;
    setLoading((previous) => ({ ...previous, like: true }));
    try {
      await interactSocialPost({
        action: liked ? 'unlike' : 'like',
        cid: post.cid,
        network: post.network,
        post_id: post.id,
      });
      setLiked(!liked);
      setLikeCount((previous) => liked ? previous - 1 : previous + 1);
    } catch (error: unknown) {
      console.error('Like failed:', error);
    } finally {
      setLoading((previous) => ({ ...previous, like: false }));
    }
  };

  const handleRepost = async (
    event: MouseEvent<HTMLButtonElement>,
  ): Promise<void> => {
    event.stopPropagation();
    if (post.network === 'scheduled') return;
    setLoading((previous) => ({ ...previous, repost: true }));
    try {
      await interactSocialPost({
        action: reposted ? 'unreblog' : 'reblog',
        cid: post.cid,
        network: post.network,
        post_id: post.id,
      });
      setReposted(!reposted);
      setRepostCount((previous) => reposted ? previous - 1 : previous + 1);
    } catch (error: unknown) {
      console.error('Repost failed:', error);
    } finally {
      setLoading((previous) => ({ ...previous, repost: false }));
    }
  };

  const openPost = (): void => {
    if (post.url) globalThis.open(post.url, '_blank');
  };

  const stopAndOpen = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    openPost();
  };

  return (
    <article
      className="group cursor-pointer rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4 transition-all duration-200 hover:bg-[var(--bg-secondary)] hover:shadow-md"
      data-testid="post-card"
      onClick={openPost}
    >
      {post.is_reblog && post.reblog_by && (
        <div className="mb-2 ml-10 flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)]">
          <Repeat size={12} />
          <span>{t('social.boosted_by', '{{name}} boosted', {
            name: post.reblog_by,
          })}</span>
        </div>
      )}
      <div className="flex gap-3">
        <div className="shrink-0 pt-1">
          <div className="h-10 w-10 overflow-hidden rounded-full bg-[var(--bg-tertiary)] ring-2 ring-[var(--border-primary)] transition-all">
            {post.avatar ? (
              <img
                alt={post.author}
                className="w-full h-full object-cover"
                src={post.avatar}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-lg">👤</div>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-1">
            <div className="truncate pr-2">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold text-[var(--text-primary)] hover:underline">
                  {post.author}
                </span>
                <span className={`ml-1 rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${networkColor(post.network)}`}>
                  {post.network}
                </span>
              </div>
              <div className="truncate text-xs text-[var(--text-tertiary)]">
                {post.handle}
              </div>
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs text-[var(--text-tertiary)]">
              {new Date(post.timestamp).toLocaleDateString(undefined, {
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                month: 'short',
              })}
            </span>
          </div>
          <p className="mb-3 whitespace-pre-wrap break-words text-[15px] font-normal leading-relaxed text-[var(--text-primary)]">
            {post.content}
          </p>
          {post.network !== 'scheduled' && (
            <div className="flex max-w-[80%] items-center justify-between text-[var(--text-tertiary)]">
              <button
                aria-label={t('social.open_post', 'Open post')}
                className="group/btn -ml-1.5 flex items-center gap-1.5 rounded-full p-1.5 transition-all hover:bg-blue-500/10 hover:text-blue-500"
                onClick={stopAndOpen}
              >
                <MessageCircle size={16} />
                <span className="text-xs">{post.replies_count}</span>
              </button>
              <button
                aria-label={t('social.repost', 'Repost')}
                className={`flex items-center gap-1.5 p-1.5 rounded-full hover:bg-green-500/10 transition-all ${reposted ? 'text-green-500' : 'hover:text-green-500'}`}
                disabled={loading.repost}
                onClick={(event) => {
                  void handleRepost(event);
                }}
              >
                <Repeat size={16} />
                <span className="text-xs">{repostCount}</span>
              </button>
              <button
                aria-label={t('social.like', 'Like')}
                className={`flex items-center gap-1.5 p-1.5 rounded-full hover:bg-red-500/10 transition-all ${liked ? 'text-red-500' : 'hover:text-red-400'}`}
                disabled={loading.like}
                onClick={(event) => {
                  void handleLike(event);
                }}
              >
                <Heart fill={liked ? 'currentColor' : 'none'} size={16} />
                <span className={`text-xs ${liked ? 'font-medium' : ''}`}>
                  {likeCount}
                </span>
              </button>
              <button
                aria-label={t('social.share_post', 'Share post')}
                className="flex items-center gap-1.5 rounded-full p-1.5 transition-all hover:bg-blue-500/10 hover:text-blue-500"
                onClick={stopAndOpen}
              >
                <Share size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
