import { Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { conferenceJoinUrl } from './conferenceJoinUrl';

export function ConferenceJoinButton({ url }: { readonly url: unknown }) {
  const { t } = useTranslation();
  const href = conferenceJoinUrl(url);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
      className="btn-gnosi btn-gnosi-primary inline-flex w-full items-center justify-center gap-2"
      aria-label={t('calendar.join_conference_external', 'Join video call (opens in your browser)')}>
      <Video size={16} aria-hidden="true" />
      {t('calendar.join_conference', 'Join video call')}
    </a>
  );
}
