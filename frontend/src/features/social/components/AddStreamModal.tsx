import {
  useCallback,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  Bell,
  Check,
  Globe,
  Hash,
  Plus,
  Rss,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import type { SocialStream } from '../../../shared/api/social';
import { SocialNetworkIcon } from './network/social/SocialNetworkIcon';


interface NetworkOption {
  readonly color: string;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
}


interface StreamTypeOption {
  readonly description: string;
  readonly icon: LucideIcon;
  readonly id: string;
  readonly label: string;
}


const DEFAULT_NETWORK: NetworkOption = {
  color: 'bg-purple-500/20 text-purple-200',
  icon: '🐘',
  id: 'mastodon',
  name: 'Mastodon',
};


const NETWORKS: readonly NetworkOption[] = [
  DEFAULT_NETWORK,
  { color: 'bg-blue-500/20 text-blue-200', icon: '🦋', id: 'bluesky', name: 'Bluesky' },
  { color: 'bg-blue-700/20 text-blue-200', icon: '💼', id: 'linkedin', name: 'LinkedIn' },
  { color: 'bg-blue-600/20 text-blue-200', icon: '📘', id: 'facebook', name: 'Facebook' },
  { color: 'bg-sky-500/20 text-sky-200', icon: '✈️', id: 'telegram', name: 'Telegram' },
];


const DEFAULT_STREAM_TYPE: StreamTypeOption = {
  description: 'Following feed',
  icon: Rss,
  id: 'home',
  label: 'Home Timeline',
};


const STREAM_TYPES: readonly StreamTypeOption[] = [
  DEFAULT_STREAM_TYPE,
  { description: 'Posts sent via this app', icon: Rss, id: 'my-posts', label: 'My Published History' },
  { description: 'Mentions and interactions', icon: Bell, id: 'notifications', label: 'Notifications' },
  { description: 'Global activity', icon: Globe, id: 'public', label: 'Public / Federated' },
  { description: 'Track specific tags', icon: Hash, id: 'tag', label: 'Hashtag' },
];


export interface AddStreamModalProps {
  readonly isOpen: boolean;
  readonly onAdd: (stream: SocialStream) => unknown;
  readonly onClose: () => unknown;
}


export default function AddStreamModal({
  isOpen,
  onAdd,
  onClose,
}: AddStreamModalProps) {
  const { t } = useTranslation();
  const [selectedNetwork, setSelectedNetwork] = useState(DEFAULT_NETWORK);
  const [selectedType, setSelectedType] = useState(DEFAULT_STREAM_TYPE);
  const modalRef = useRef<HTMLDivElement | null>(null);

  const handleSubmit = useCallback((
    event?: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): void => {
    event?.preventDefault();
    const stream = {
      icon: selectedNetwork.icon,
      id: `${selectedNetwork.id}-${selectedType.id}`,
      network: selectedNetwork.id,
      title: `${selectedNetwork.name} ${selectedType.label}`,
      type: selectedType.id,
    };
    onAdd(stream);
    onClose();
  }, [onAdd, onClose, selectedNetwork, selectedType]);

  useModalKeyboard({
    containerRef: modalRef,
    isOpen,
    onClose,
    onConfirm: () => {
      handleSubmit();
    },
    trapFocus: true,
  });

  if (!isOpen) return null;

  const restrictedNetwork = ['facebook', 'linkedin', 'telegram']
    .includes(selectedNetwork.id);
  const visibleStreamTypes = STREAM_TYPES.filter((streamType) => {
    if (streamType.id === 'home' && restrictedNetwork) return false;
    if (streamType.id === 'my-posts' && !restrictedNetwork) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" />
      <div
        aria-label={t('social.add_stream_title', 'Add New Stream')}
        aria-modal="true"
        className="relative w-full max-w-md bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        ref={modalRef}
        role="dialog"
      >
        <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/5">
          <h2 className="text-xl font-semibold text-white">
            {t('social.add_stream_title', 'Add New Stream')}
          </h2>
          <button
            aria-label={t('common.close', 'Close')}
            className="text-zinc-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        <form className="p-6 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
              {t('social.network', 'Network')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              {NETWORKS.map((network) => (
                <button
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${selectedNetwork.id === network.id
                    ? 'bg-primary/10 border-primary/50 text-white shadow-[0_0_15px_rgba(59,130,246,0.15)]'
                    : 'bg-white/5 border-transparent text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                  }`}
                  key={network.id}
                  onClick={() => {
                    setSelectedNetwork(network);
                  }}
                  type="button"
                >
                  <SocialNetworkIcon network={network.id} size={22} />
                  <span className="font-medium">{network.name}</span>
                  {selectedNetwork.id === network.id && (
                    <Check className="ml-auto text-primary" size={16} />
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
              {t('social.stream_type', 'Stream Type')}
            </label>
            <div className="grid grid-cols-1 gap-2">
              {visibleStreamTypes.map((streamType) => {
                const Icon = streamType.icon;
                return (
                  <button
                    className={`flex items-center gap-4 p-3 rounded-xl border transition-all text-left group ${selectedType.id === streamType.id
                      ? 'bg-white/10 border-white/20 text-white'
                      : 'bg-transparent border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                    }`}
                    key={streamType.id}
                    onClick={() => {
                      setSelectedType(streamType);
                    }}
                    type="button"
                  >
                    <div className={`p-2 rounded-lg transition-colors ${selectedType.id === streamType.id
                      ? 'bg-primary text-white'
                      : 'bg-white/5 text-zinc-500 group-hover:text-zinc-300'
                    }`}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <div className="font-medium">
                        {t(`social.stream.${streamType.id}.label`, streamType.label)}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {t(`social.stream.${streamType.id}.desc`, streamType.description)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <button
            className="w-full bg-primary hover:bg-blue-600 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 mt-4"
            data-autofocus="true"
            type="submit"
          >
            <Plus size={20} />
            {t('social.add_stream', 'Add stream')}
          </button>
        </form>
      </div>
    </div>
  );
}
