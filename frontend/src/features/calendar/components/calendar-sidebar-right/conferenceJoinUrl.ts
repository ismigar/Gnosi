/** Calendar content is untrusted even when received from a configured provider. */
export function conferenceJoinUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 32 || code === 127) return null;
  }
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
