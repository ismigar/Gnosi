import {memo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {NON_IMAGE_THUMB} from './constants';
import type {MediaLayout} from './model';
import {CloudOff} from 'lucide-react';
export const Thumb = memo(function Thumb({ src, alt, viewMode, kind }: {src: string; alt: string; viewMode: MediaLayout; kind: string}) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 4000;

  const wrapperClass = viewMode === 'grid'
    ? 'aspect-square relative overflow-hidden bg-gray-900'
    : 'w-24 h-24 relative rounded-xl overflow-hidden flex-shrink-0 bg-gray-900';

  // Video / PDF / audio / other: never go into `<img>` — placeholder with an icon
  // of the type and file name.
  if (kind && kind !== 'image') {
    const meta = NON_IMAGE_THUMB[kind] ?? NON_IMAGE_THUMB.other ?? {Icon: CloudOff, labelKey: "media.thumb_other", accent: "text-slate-400"};
    const Icon = meta.Icon;
    return (
      <div className={`${wrapperClass} bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center gap-1.5 p-2`}>
        <Icon size={viewMode === 'grid' ? 36 : 24} className={`${meta.accent} opacity-90`} />
        <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">{t(meta.labelKey)}</span>
        <span className="text-[9px] text-slate-500 truncate w-full text-center" title={alt}>{alt}</span>
      </div>
    );
  }

  // The `?_r=N` query param forces the browser not to serve it from cache.
  const finalSrc = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}_r=${String(attempt)}`;

  if (failed) {
    return (
      <div className={`${wrapperClass} bg-slate-800 text-slate-400 flex flex-col items-center justify-center gap-1 p-2`}>
        <CloudOff size={28} className="opacity-60" />
        <span className="text-[9px] text-center leading-tight opacity-70">{t('media.not_downloaded')}</span>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <img
        src={finalSrc}
        alt={alt}
        title={alt}
        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        loading="lazy"
        onError={() => {
          if (attempt < MAX_RETRIES) {
            setTimeout(() => { setAttempt((n) => n + 1); }, RETRY_DELAY_MS * (attempt + 1));
          } else {
            setFailed(true);
          }
        }}
      />
    </div>
  );
});
