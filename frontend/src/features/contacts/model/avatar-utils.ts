/** Utilities for fetching and managing contact avatars. */

type EmailInput = string | null | undefined;

/** Checks whether an email belongs to a Gmail/Google account. */
export const isGmail = (email: EmailInput): boolean => {
  if (!email) return false;
  const lowerEmail = email.toLowerCase();
  return (
    lowerEmail.endsWith('@gmail.com') ||
    lowerEmail.endsWith('@googlemail.com')
  );
};

/**
 * There is no unauthenticated public Google profile-photo URL. Consumers use
 * the empty value to preserve the existing initials fallback without leaking
 * contact email addresses to a retired Google+ endpoint.
 */
export const getGoogleAvatarUrl = (email: EmailInput): string => {
  if (!email) return '';
  return '';
};

/** Keeps the existing empty Gravatar fallback until hashing is supported. */
export const getGravatarUrl = (email: EmailInput): string => {
  if (!email) return '';
  return '';
};
