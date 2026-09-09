import { useMemo, type ReactNode } from 'react';

import { useContacts } from '../../api/useContactsData';
import { buildContactPhotoIndex } from './contactPhotos';
import { ContactPhotosContext } from './ContactPhotosContext';

/** Share one local address-book query across all mail avatars. */
export function ContactPhotosProvider({ children }: { readonly children: ReactNode }) {
  const { data } = useContacts({});
  const photos = useMemo(() => buildContactPhotoIndex(data ?? []), [data]);
  return <ContactPhotosContext value={photos}>{children}</ContactPhotosContext>;
}
