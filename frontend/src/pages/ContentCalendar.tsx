import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Clock, Trash2 } from 'lucide-react';

import ConfirmModal from '../components/ConfirmModal';
import i18n from '../i18n';
import { logError } from '../lib/notifyError';
import { toast } from '../lib/toast';
import {
  useCancelScheduledSocialPost,
  useScheduledSocialPosts,
} from '../shared/api/useSocialData';
import {
  formatScheduledTime,
  isLocalToday,
  postsForLocalDay,
  weekDaysFor,
} from './contentCalendarUtils';


/** Render scheduled social posts in a local-time weekly calendar. */
export default function ContentCalendar() {
  const [currentWeek, setCurrentWeek] = useState(() => new Date());
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const { t } = useTranslation();
  const { data: scheduledPosts = [], isLoading } = useScheduledSocialPosts();
  const cancelScheduledPost = useCancelScheduledSocialPost();
  const weekDays = weekDaysFor(currentWeek);

  const doCancelPost = async (): Promise<void> => {
    const postId = confirmTarget;
    if (!postId) return;
    setConfirmTarget(null);
    try {
      await cancelScheduledPost.mutateAsync(postId);
      toast.success(t('content_calendar.post_cancelled', 'Post canceled'));
    } catch (error: unknown) {
      logError('content-calendar-cancel', error);
      toast.error(t(
        'content_calendar.cancel_post_error',
        'Error cancelling post',
      ));
    }
  };

  const navigateWeek = (direction: -1 | 1): void => {
    setCurrentWeek((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + direction * 7);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <div className="flex items-center gap-4 mb-4 shrink-0">
        <div className="flex items-center gap-2 bg-[var(--bg-secondary)] rounded-lg p-1 border border-[var(--border-primary)]">
          <button
            type="button"
            onClick={() => {
              navigateWeek(-1);
            }}
            className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-md transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="font-semibold text-sm w-36 text-center text-[var(--text-primary)]">
            {weekDays.at(0)?.toLocaleDateString(i18n.language, {
              day: 'numeric',
              month: 'short',
            })}
            {' – '}
            {weekDays.at(-1)?.toLocaleDateString(i18n.language, {
              day: 'numeric',
              month: 'short',
            })}
          </span>
          <button
            type="button"
            onClick={() => {
              navigateWeek(1);
            }}
            className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-md transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {isLoading
          ? (
              <div className="flex flex-col justify-center items-center h-full text-zinc-500 gap-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                <span>{t('content_calendar.loading', 'Loading calendar...')}</span>
              </div>
            )
          : (
              <div className="grid grid-cols-7 gap-4 flex-1 min-h-0">
                {weekDays.map((day) => {
                  const dayPosts = postsForLocalDay(scheduledPosts, day);
                  const today = isLocalToday(day);
                  return (
                    <div
                      key={day.toISOString()}
                      className={`flex flex-col rounded-xl overflow-hidden transition-all duration-300 ${today ? 'glass-panel border-primary/50 bg-primary/10 shadow-lg shadow-primary/10' : 'glass-card hover:bg-white/5 border-white/5'}`}
                    >
                      <div className={`p-3 text-center border-b flex flex-col items-center gap-1 ${today ? 'border-primary/20 bg-primary/20' : 'border-white/5 bg-white/5'}`}>
                        <div className={`text-xs font-semibold uppercase tracking-wider ${today ? 'text-blue-200' : 'text-zinc-500'}`}>
                          {day.toLocaleDateString(i18n.language, { weekday: 'short' })}
                        </div>
                        <div className={`text-2xl font-bold ${today ? 'text-white' : 'text-zinc-300'}`}>
                          {day.getDate()}
                        </div>
                      </div>

                      <div className="flex-1 p-2 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
                        {dayPosts.length === 0
                          ? (
                              <div className="text-xs text-zinc-600 text-center py-8 flex flex-col items-center gap-2 opacity-50">
                                <span>—</span>
                              </div>
                            )
                          : dayPosts.map((post) => (
                              <div
                                key={post.id}
                                className="group relative p-3 bg-black/20 hover:bg-black/40 border border-white/5 hover:border-white/10 rounded-lg transition-all"
                              >
                                <div className="flex items-center gap-1.5 text-xs font-medium text-blue-400 mb-1.5">
                                  <Clock size={12} />
                                  {formatScheduledTime(post.scheduled_time)}
                                </div>
                                <div className="text-sm text-zinc-300 line-clamp-3 mb-2 leading-relaxed">
                                  {post.content}
                                </div>
                                <div className="flex gap-1 flex-wrap">
                                  {post.networks.map((network) => (
                                    <span
                                      key={network}
                                      className="px-1.5 py-0.5 bg-white/10 text-zinc-400 rounded text-[10px] uppercase font-bold tracking-wider"
                                    >
                                      {network}
                                    </span>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmTarget(post.id);
                                  }}
                                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded transition-all"
                                  title={t(
                                    'content_calendar.cancel_post_button',
                                    'Cancel',
                                  )}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
      </div>

      <ConfirmModal
        isOpen={confirmTarget !== null}
        onClose={() => {
          setConfirmTarget(null);
        }}
        onConfirm={doCancelPost}
        title={t('content_calendar.cancel_confirm_title', 'Cancel post')}
        message={t(
          'content_calendar.cancel_confirm_message',
          'Cancel this scheduled post?',
        )}
        confirmText={t(
          'content_calendar.cancel_confirm_yes',
          'Yes, cancel',
        )}
        cancelText={t('content_calendar.cancel_confirm_no', 'No')}
        isDestructive
      />
    </div>
  );
}
