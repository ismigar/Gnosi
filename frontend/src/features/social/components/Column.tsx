import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import PostCard from './PostCard';
import { SocialNetworkIcon } from '../../../components/social/SocialNetworkIcon';
import { isKnownSocialNetwork } from '../../../components/social/socialNetworkModel';
import type { SocialPost } from '../../../shared/api/social';

export interface SocialColumnProps {
    readonly icon?: ReactNode;
    readonly network: string;
    readonly onDelete?: () => void;
    readonly onRefresh?: () => void;
    readonly posts?: readonly SocialPost[];
    readonly title: ReactNode;
}

const Column = ({
    title,
    icon,
    network,
    posts = [],
    onDelete,
    onRefresh,
}: SocialColumnProps) => {
    const { t } = useTranslation();
    const streamIcon = isKnownSocialNetwork(network)
        ? <SocialNetworkIcon network={network} size={22} />
        : <span className="text-xl">{icon}</span>;
    return (
        <div className="glass-card flex h-full min-w-[calc(100vw-3rem)] max-w-[400px] shrink-0 flex-col overflow-hidden rounded-xl shadow-lg sm:min-w-[360px]">
            <div className="p-4 border-b border-[var(--border-primary)] font-semibold text-[var(--text-primary)] flex justify-between items-center bg-[var(--bg-secondary)]/50 backdrop-blur-md relative z-10">
                <div className="flex items-center gap-3">
                    {streamIcon}
                    <span className="tracking-wide">{title}</span>
                    <span className="bg-[var(--bg-tertiary)] text-xs px-2 py-0.5 rounded-full text-[var(--text-secondary)]">{posts.length}</span>
                </div>

                <div className="relative group">
                    <button
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] p-1 rounded-lg transition-colors"
                        aria-label={t('social.stream_actions', 'Stream actions')}
                    >
                        <MoreHorizontal size={20} />
                    </button>

                    {/* Dropdown Menu */}
                    <div className="absolute right-0 top-full mt-1 w-32 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl shadow-xl overflow-hidden hidden group-hover:block animate-in fade-in zoom-in-95 duration-100">
                        <button
                            onClick={onRefresh}
                            className="w-full text-left px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                        >
                            {t('common.refresh', 'Refresh')}
                        </button>
                        <button
                            onClick={onDelete}
                            className="w-full text-left px-4 py-2 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            {t('common.delete', 'Delete')}
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
                            {isKnownSocialNetwork(network)
                                ? <SocialNetworkIcon network={network} size={26} />
                                : <span className="text-2xl opacity-50">{icon}</span>}
                        </div>
                        <p>{t('social.column_empty', "No recent posts")}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Column;
