import { createContext } from 'react';

import type { ContactPhotoIndex } from './contactPhotos';

export const ContactPhotosContext = createContext<ContactPhotoIndex>(new Map());
