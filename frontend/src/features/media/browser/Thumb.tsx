import {memo, type RefObject} from 'react';
import {useTranslation} from 'react-i18next';
import {NON_IMAGE_THUMB} from './constants';
import type {MediaLayout} from './model';
import {CloudOff, Loader2} from 'lucide-react';
import {useImageRecovery} from './useImageRecovery';
import {useThumbnailVisibility} from './useThumbnailVisibility';
export const Thumb = memo(function Thumb({ src, alt, viewMode, kind, scrollRoot }: {src: string; alt: string; viewMode: MediaLayout; kind: string; scrollRoot?: RefObject<Element | null>}) {
  const { t } = useTranslation();
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

  // A different source has its own retry lifecycle, including timer/blob cleanup.
  return <ImageThumb key={src} src={src} alt={alt} wrapperClass={wrapperClass} scrollRoot={scrollRoot}/>;
});

function ImageThumb({src, alt, wrapperClass, scrollRoot}: {src: string; alt: string; wrapperClass: string; scrollRoot?: RefObject<Element | null>}) {
  const {t} = useTranslation();
  const {targetRef, visible} = useThumbnailVisibility(scrollRoot);
  const recovery = useImageRecovery(src);

  if (recovery.phase === 'failed') {
    return (
      <div className={`${wrapperClass} bg-slate-800 text-slate-400 flex flex-col items-center justify-center gap-1 p-2`}>
        <CloudOff size={28} className="opacity-60" />
        <span className="text-[9px] text-center leading-tight opacity-70">{t('media.not_downloaded')}</span>
        <button type="button" disabled={!recovery.retryReady}
          className="text-xs underline disabled:opacity-50"
          onClick={event => {event.stopPropagation(); recovery.recover();}}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div ref={targetRef} className={wrapperClass} aria-busy={recovery.phase === 'pending'}>
      {visible && recovery.phase !== 'pending' && <img
        src={recovery.recoveredSrc ?? src}
        alt={alt}
        title={alt}
        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        loading="lazy"
        decoding="async"
        onError={recovery.onError}
      />}
      {recovery.phase === 'pending' && (
        <div role="status" className="absolute inset-0 bg-slate-800 text-slate-300 flex flex-col items-center justify-center gap-2 p-2">
          <Loader2 size={24} className="animate-spin"/>
          <span className="text-xs">{t('media.loading')}</span>
        </div>
      )}
    </div>
  );
}
