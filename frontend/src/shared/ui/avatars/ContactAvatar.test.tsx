import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContactAvatar } from './ContactAvatar';
import { ContactPhotosContext } from './ContactPhotosContext';
import { buildContactPhotoIndex, contactEmailKey } from './contactPhotos';

const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

describe('contact photos in contacts and mail', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    delete reactGlobal.IS_REACT_ACT_ENVIRONMENT;
  });

  it('matches From headers and all stored addresses without inventing Gmail aliases', () => {
    const photos = buildContactPhotoIndex([
      { email: 'ada@gmail.com', emails: [], photo_url: null },
      { email: 'ADA@gmail.com ', emails: [{ value: 'ada@work.test' }, null, { value: 42 }], photo_url: 'https://photos.test/ada.jpg' },
    ]);
    act(() => {
      root.render(
        <ContactPhotosContext value={photos}>
          <ContactAvatar name="Ada Lovelace" email={'"Lovelace, Ada" <ADA@WORK.TEST>'} />
        </ContactPhotosContext>,
      );
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://photos.test/ada.jpg');
    expect(photos.get('ada@gmail.com')).toBe('https://photos.test/ada.jpg');
    expect(photos.has('a.da@gmail.com')).toBe(false);
    expect(contactEmailKey('Ada')).toBe('');
    expect(contactEmailKey('one@test.test, two@test.test')).toBe('');
  });

  it('prefers an explicit photo and does not send the page referrer', () => {
    act(() => {
      root.render(
        <ContactPhotosContext value={new Map([['ada@gmail.com', 'https://photos.test/google.jpg']])}>
          <ContactAvatar name="Ada" email="ada@gmail.com" photoUrl="https://photos.test/manual.jpg" />
        </ContactPhotosContext>,
      );
    });
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://photos.test/manual.jpg');
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(image?.alt).toBe('');
  });

  it('shows initials on failure and recovers when a refreshed URL arrives', () => {
    act(() => { root.render(<ContactAvatar name="Ada Lovelace" photoUrl="https://photos.test/expired.jpg" />); });
    act(() => { container.querySelector('img')?.dispatchEvent(new Event('error')); });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('AL');
    act(() => { root.render(<ContactAvatar name="Grace Hopper" photoUrl="https://photos.test/new.jpg" />); });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://photos.test/new.jpg');
    expect(container.textContent).toBe('GH');
  });

  it('keeps Gmail addresses without a known photo local and shows initials', () => {
    act(() => { root.render(<ContactAvatar name="Ada Lovelace" email="ada@gmail.com" />); });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('AL');
  });
});
