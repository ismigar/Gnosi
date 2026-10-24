export function validProviderRoute(value: string | null | undefined): boolean {
  const route = value?.trim().toLowerCase() ?? '';
  return route.length <= 128 && (!route || /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(route));
}
