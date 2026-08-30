import {
  Calendar,
  CheckCircle,
  Clock,
  RefreshCw,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import i18n from '../../shared/i18n/i18n';
import { useSocialPostHistory } from '../../shared/api/useSocialData';


interface StatusConfig {
  readonly background: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly text: string;
}


function formatHistoryDate(
  isoString: string | null | undefined,
  locale = i18n.language,
): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(locale, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}


export default function PostHistory() {
  const { t } = useTranslation();
  const historyQuery = useSocialPostHistory();
  const history = [...(historyQuery.data ?? [])].reverse();
  const loading = historyQuery.isLoading;
  const isRefreshing = historyQuery.isFetching && !loading;

  const statusConfig = (status: string): StatusConfig => {
    if (status === 'success') {
      return {
        background: 'bg-green-500/10',
        icon: CheckCircle,
        label: t('social.status_published', 'Published'),
        text: 'text-green-400',
      };
    }
    if (status === 'failed') {
      return {
        background: 'bg-red-500/10',
        icon: XCircle,
        label: t('common.error', 'Error'),
        text: 'text-red-400',
      };
    }
    return {
      background: 'bg-yellow-500/10',
      icon: Clock,
      label: t('dashboard.status_pending', 'Pending'),
      text: 'text-yellow-400',
    };
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex justify-end mb-4 shrink-0">
        <button
          className={`p-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] transition-all ${isRefreshing ? 'animate-spin' : ''}`}
          onClick={() => {
            void historyQuery.refetch();
          }}
          title={t('common.refresh', 'Refresh')}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <div className="max-w-3xl mx-auto space-y-6 pb-12">
        {loading ? (
          <div className="flex flex-col justify-center items-center h-64 text-zinc-500 gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <span>{t('social.history_loading', 'Loading history...')}</span>
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-zinc-500 bg-white/5 rounded-2xl border border-white/5">
            <div className="text-4xl mb-4 opacity-50">📜</div>
            <p>{t('social.history_empty', 'No posts in the history yet.')}</p>
          </div>
        ) : history.map((post) => {
          const config = statusConfig(post.status);
          const StatusIcon = config.icon;
          return (
            <div
              className="glass-card rounded-xl border border-white/5 p-5 relative overflow-hidden group hover:bg-white/5 transition-all"
              key={post.id}
            >
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${config.background.replace('/10', '/50')}`} />
              <div className="flex justify-between items-start mb-3 pl-2">
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Calendar size={14} />
                  {formatHistoryDate(post.published_at)}
                </div>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.background} ${config.text}`}>
                  <StatusIcon size={14} />
                  <span>{config.label}</span>
                </div>
              </div>
              <p className="text-zinc-200 mb-4 whitespace-pre-wrap pl-2 leading-relaxed text-sm">
                {post.content}
              </p>
              <div className="flex justify-between items-end pl-2">
                <div className="flex gap-2 flex-wrap">
                  {post.networks.map((network) => (
                    <span
                      className="px-2 py-1 bg-black/20 border border-white/5 rounded-md text-[10px] uppercase font-bold tracking-wider text-zinc-400"
                      key={network}
                    >
                      {network}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
