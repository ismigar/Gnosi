/** Public token pages use their own credential and do not need workspace bootstrap. */
export function isPublicTokenPath(path: string): boolean {
  return /^\/(?:s|forms|book)\/[^/]+\/?$/.test(path);
}
