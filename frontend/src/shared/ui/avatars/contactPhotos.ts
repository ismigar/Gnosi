import type { Contact } from '../../api/contacts';

export type ContactPhotoIndex = ReadonlyMap<string, string>;

/** Normalize a mailbox, including a quoted display name in a From header. */
export function contactEmailKey(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  const mailbox = trimmed.match(/<([^<>]+)>\s*$/u)?.[1] ?? trimmed;
  const email = mailbox.trim().toLowerCase();
  return /^[^\s<>@,;]+@[^\s<>@,;]+$/u.test(email) ? email : '';
}

/** Keep explicit photos from the address book; never guess a provider URL. */
export function buildContactPhotoIndex(contacts: readonly Pick<Contact, 'email' | 'emails' | 'photo_url'>[]): ContactPhotoIndex {
  const photos = new Map<string, string>();
  for (const contact of contacts) {
    const photo = contact.photo_url?.trim();
    if (!photo) continue;
    const emails = [contact.email];
    if (Array.isArray(contact.emails)) {
      const entries: readonly unknown[] = contact.emails;
      for (const entry of entries) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)
          && 'value' in entry && typeof entry.value === 'string') emails.push(entry.value);
      }
    }
    for (const value of emails) {
      const email = contactEmailKey(value);
      if (email && !photos.has(email)) photos.set(email, photo);
    }
  }
  return photos;
}

export function contactInitials(name: string | null | undefined, email?: string | null): string {
  const label = (name?.replace(/<[^<>]*>/gu, '').replace(/^\s*"|"\s*$/gu, '').trim()
    || contactEmailKey(email) || '?').split('@')[0] ?? '?';
  return label.split(/\s+/u).filter(Boolean).slice(0, 2)
    .map((part) => Array.from(part)[0]).join('').toUpperCase() || '?';
}
