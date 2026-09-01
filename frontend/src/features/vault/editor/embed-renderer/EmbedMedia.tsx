import { useState } from 'react';

import {
  getImageRetryDelay,
  toVimeoEmbedUrl,
  toYouTubeEmbedUrl,
  type EmbedKind,
} from './embedRendererModel';


interface EmbedMediaProps {
  readonly caption: string;
  readonly kind: EmbedKind;
  readonly url: string;
}


interface RetryableEmbedImageProps {
  readonly alt: string;
  readonly src: string;
}


function RetryableEmbedImage({
  alt,
  src,
}: RetryableEmbedImageProps): React.JSX.Element {
  const [attempt, setAttempt] = useState(0);

  const retry = (): void => {
    const delay = getImageRetryDelay(attempt);
    if (delay === null) return;
    window.setTimeout(() => {
      setAttempt((currentAttempt) => currentAttempt + 1);
    }, delay);
  };

  return (
    <img
      key={attempt}
      src={src}
      alt={alt}
      className="max-w-full rounded-lg border border-[var(--border-primary)]"
      onError={retry}
    />
  );
}


export function EmbedMedia({
  caption,
  kind,
  url,
}: EmbedMediaProps): React.JSX.Element | null {
  const title = caption || url;

  if (kind === 'pdf' || kind === 'iframe') {
    return (
      <iframe
        src={url}
        title={title}
        className="w-full h-[600px] rounded-lg border border-[var(--border-primary)] bg-white"
        loading="lazy"
      />
    );
  }
  if (kind === 'youtube') {
    return (
      <iframe
        src={toYouTubeEmbedUrl(url)}
        title={title}
        className="w-full aspect-video rounded-lg border border-[var(--border-primary)] bg-black"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }
  if (kind === 'vimeo') {
    return (
      <iframe
        src={toVimeoEmbedUrl(url)}
        title={title}
        className="w-full aspect-video rounded-lg border border-[var(--border-primary)] bg-black"
        loading="lazy"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  }
  if (kind === 'video') {
    return (
      <video
        src={url}
        controls
        className="w-full rounded-lg border border-[var(--border-primary)] bg-black"
      />
    );
  }
  if (kind === 'audio') {
    return <audio src={url} controls className="w-full" />;
  }
  if (kind === 'image') {
    return <RetryableEmbedImage src={url} alt={caption || ''} />;
  }
  return null;
}
