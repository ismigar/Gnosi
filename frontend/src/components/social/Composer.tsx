import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  Loader2,
  Send,
  X,
} from 'lucide-react';

import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import type { SocialNetwork } from '../../shared/api/social';
import {
  useCreateSocialPost,
  useScheduleSocialPosts,
  useSocialNetworks,
} from '../../shared/api/useSocialData';
import Scheduler from './Scheduler';


interface NetworkStyle {
  readonly border: string;
  readonly color: string;
}


type StyledSocialNetwork = SocialNetwork & NetworkStyle;


const DEFAULT_NETWORK_STYLE: NetworkStyle = {
  border: 'border-zinc-500/50',
  color: 'bg-zinc-600',
};


const NETWORK_STYLES: Readonly<Record<string, NetworkStyle>> = {
  bluesky: { border: 'border-blue-400/50', color: 'bg-blue-500' },
  facebook: { border: 'border-blue-500/50', color: 'bg-blue-600' },
  linkedin: { border: 'border-blue-600/50', color: 'bg-blue-700' },
  mastodon: { border: 'border-purple-500/50', color: 'bg-purple-600' },
  telegram: { border: 'border-sky-400/50', color: 'bg-sky-400' },
};


function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === 'string' && error ? error : 'Unknown error';
}


/** Compose, publish, or schedule one post across enabled social networks. */
export default function Composer() {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<string[] | null>(
    null,
  );
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledTime, setScheduledTime] = useState<Date | null>(null);
  const networksQuery = useSocialNetworks();
  const createPost = useCreateSocialPost();
  const schedulePosts = useScheduleSocialPosts();
  const networks: StyledSocialNetwork[] = (networksQuery.data ?? [])
    .filter((network) => network.enabled)
    .map((network) => ({
      ...network,
      ...(NETWORK_STYLES[network.id] ?? DEFAULT_NETWORK_STYLE),
    }));
  const selectedNetworks = selectedNetworkIds
    ?? networks.map((network) => network.id);
  const isPosting = createPost.isPending || schedulePosts.isPending;

  const toggleNetwork = (id: string): void => {
    setSelectedNetworkIds((previous) => {
      const current = previous ?? networks.map((network) => network.id);
      return current.includes(id)
        ? current.filter((networkId) => networkId !== id)
        : [...current, id];
    });
  };

  const handlePost = async (immediate = true): Promise<void> => {
    try {
      let successMessage: string;
      if (immediate) {
        await createPost.mutateAsync({ content, networks: selectedNetworks });
        successMessage = t(
          'social.post_success',
          'Post published successfully!',
        );
      } else {
        const scheduledAt = scheduledTime;
        if (!scheduledAt) return;
        await schedulePosts.mutateAsync({
          posts: Object.fromEntries(
            selectedNetworks.map((network) => [network, { text: content }]),
          ),
          scheduled_time: scheduledAt.toISOString(),
        });
        successMessage = t(
          'social.post_scheduled_for',
          'Post scheduled for {{time}}',
          { time: scheduledAt.toLocaleString() },
        );
      }

      toast.success(successMessage);
      setContent('');
      setScheduledTime(null);
      setShowScheduler(false);
    } catch (error: unknown) {
      logError('social-composer', error);
      toast.error(t(
        'social.post_error',
        'Error: {{message}}',
        { message: describeError(error) },
      ));
    }
  };

  const handleSchedule = (dateTime: Date): void => {
    setScheduledTime(dateTime);
    setShowScheduler(false);
  };

  const effectiveLimit = selectedNetworks.length > 0
    ? Math.min(...selectedNetworks.map((id) => (
        networks.find((network) => network.id === id)?.char_limit ?? 500
      )))
    : Number.POSITIVE_INFINITY;
  const overLimit = content.length > effectiveLimit;

  return (
    <div className="glass-panel p-6 rounded-2xl shadow-xl border border-[var(--border-primary)] relative z-10 backdrop-blur-xl">
      <div className="mb-4 flex flex-wrap gap-2">
        {networks.map((network) => {
          const isSelected = selectedNetworks.includes(network.id);
          return (
            <button
              key={network.id}
              type="button"
              onClick={() => {
                toggleNetwork(network.id);
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 flex items-center gap-1.5 border ${isSelected ? `${network.color} text-white border-transparent shadow-lg shadow-black/20 transform -translate-y-0.5` : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'}`}
            >
              <span className="text-sm">{network.icon}</span>
              <span>{network.name}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <textarea
          className="w-full p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:ring-2 focus:ring-[var(--gnosi-blue)]/30 focus:border-[var(--gnosi-blue)]/40 focus:outline-none resize-none transition-all scrollbar-thin"
          rows={5}
          placeholder={t('social.composer_placeholder', "What's happening?")}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
          }}
        />

        <div className="absolute bottom-3 right-3 flex items-center gap-3 text-xs bg-[var(--bg-secondary)]/80 px-2 py-1 rounded-full backdrop-blur-sm">
          <span className={overLimit
            ? 'text-[var(--status-error)]'
            : 'text-[var(--text-secondary)]'}>
            {Number.isFinite(effectiveLimit)
              ? t(
                  'social.char_count_limit',
                  '{{count}} / {{limit}} characters',
                  { count: content.length, limit: effectiveLimit },
                )
              : t(
                  'social.char_count',
                  '{{count}} characters',
                  { count: content.length },
                )}
          </span>
          {overLimit && <AlertTriangle size={12} className="text-yellow-500" />}
        </div>
      </div>

      {scheduledTime && (
        <div className="mt-3 flex items-center justify-between bg-blue-500/10 border border-blue-500/20 px-3 py-2 rounded-lg text-sm text-blue-300">
          <div className="flex items-center gap-2">
            <CalendarIcon size={16} />
            <span>
              {t('social.scheduled_for', 'Scheduled for:')}{' '}
              <strong>{scheduledTime.toLocaleString()}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setScheduledTime(null);
            }}
            className="text-zinc-400 hover:text-white p-1 hover:bg-white/10 rounded"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {showScheduler && (
        <div className="absolute top-0 right-0 z-50 mt-16 mr-4">
          <div className="glass-card p-4 rounded-xl shadow-2xl border border-[var(--border-primary)]">
            <Scheduler
              onSchedule={handleSchedule}
              onCancel={() => {
                setShowScheduler(false);
              }}
            />
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mt-4">
        <button
          type="button"
          onClick={() => {
            setShowScheduler((current) => !current);
          }}
          disabled={!content || selectedNetworks.length === 0}
          className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 text-sm ${showScheduler ? 'bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] border border-[var(--gnosi-blue)]/20' : 'border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <CalendarIcon size={18} />
          <span>{t('social.schedule_button', 'Schedule')}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            void handlePost(scheduledTime === null);
          }}
          disabled={!content || selectedNetworks.length === 0 || isPosting}
          className="bg-[var(--gnosi-blue)] hover:opacity-90 disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] text-white px-6 py-2 rounded-lg font-medium transition-all shadow-lg flex items-center gap-2 transform hover:scale-105 active:scale-95 duration-200"
        >
          {isPosting
            ? <Loader2 size={18} className="animate-spin" />
            : scheduledTime
              ? <CalendarIcon size={18} />
              : <Send size={18} />}
          <span>
            {isPosting
              ? t('social.publishing', 'Publishing...')
              : scheduledTime
                ? t('social.confirm_schedule', 'Confirm Schedule')
                : t('social.publish_now', 'Publish Now')}
          </span>
        </button>
      </div>
    </div>
  );
}
