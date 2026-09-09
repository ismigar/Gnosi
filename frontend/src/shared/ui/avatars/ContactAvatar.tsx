import { useContext, useState, type CSSProperties, type ReactNode } from 'react';

import { contactEmailKey, contactInitials } from './contactPhotos';
import { ContactPhotosContext } from './ContactPhotosContext';

interface ContactAvatarProps {
  readonly name?: string | null;
  readonly email?: string | null;
  readonly photoUrl?: string | null;
  readonly size?: number;
  readonly borderRadius?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly fallback?: ReactNode;
}

export function ContactAvatar({
  name, email, photoUrl, size = 32, borderRadius = 8, className, style, fallback,
}: ContactAvatarProps) {
  const photos = useContext(ContactPhotosContext);
  const src = photoUrl?.trim() || photos.get(contactEmailKey(email)) || '';
  // Remount image state when the contact or URL changes after a failed load.
  return <AvatarImage key={`${contactEmailKey(email)}:${src}`} {...{
    src, name, email, size, borderRadius, className, style, fallback,
  }} />;
}

function AvatarImage({ src, name, email, size, borderRadius, className, style, fallback }: ContactAvatarProps & { readonly src: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        alignItems: 'center', background: 'var(--gnosi-blue)', borderRadius,
        color: 'white', display: 'inline-flex', flexShrink: 0,
        fontSize: Math.round((size ?? 32) * 0.4), fontWeight: 700,
        height: size, justifyContent: 'center', overflow: 'hidden',
        position: 'relative', width: size, ...style,
      }}
    >
      {fallback ?? contactInitials(name, email)}
      {src && !failed && (
        <img
          alt=""
          decoding="async"
          loading="lazy"
          onError={() => { setFailed(true); }}
          referrerPolicy="no-referrer"
          src={src}
          style={{ height: '100%', inset: 0, objectFit: 'cover', position: 'absolute', width: '100%' }}
        />
      )}
    </span>
  );
}
