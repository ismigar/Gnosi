export interface SidebarNavigationItem {
  readonly to: string;
}


export interface SidebarPreferences {
  readonly pinnedRoutes?: readonly unknown[];
}


export function normalizeSidebarPreferences(
  items: readonly SidebarNavigationItem[],
  preferences?: SidebarPreferences | null,
): { readonly pinnedRoutes: string[] } {
  const knownRoutes = new Set(items.map((item) => item.to));
  const requested = Array.isArray(preferences?.pinnedRoutes)
    ? preferences.pinnedRoutes.filter((route): route is string => typeof route === 'string')
    : null;
  const pinnedRoutes = (requested ?? items.map((item) => item.to))
    .filter((route, index, routes) => knownRoutes.has(route) && routes.indexOf(route) === index);
  return { pinnedRoutes };
}


export function orderSidebarItems<T extends SidebarNavigationItem>(
  items: readonly T[],
  pinnedRoutes: readonly string[],
): T[] {
  const indexByRoute = new Map(pinnedRoutes.map((route, index) => [route, index]));
  return items
    .filter((item) => indexByRoute.has(item.to))
    .sort((left, right) => (
      (indexByRoute.get(left.to) ?? Number.MAX_SAFE_INTEGER)
      - (indexByRoute.get(right.to) ?? Number.MAX_SAFE_INTEGER)
    ));
}
