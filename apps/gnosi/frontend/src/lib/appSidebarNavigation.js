export function normalizeSidebarPreferences(items, preferences) {
    const knownRoutes = new Set(items.map((item) => item.to));
    const requested = Array.isArray(preferences?.pinnedRoutes) ? preferences.pinnedRoutes : null;
    const pinnedRoutes = (requested || items.map((item) => item.to))
        .filter((route, index, routes) => knownRoutes.has(route) && routes.indexOf(route) === index);
    return { pinnedRoutes };
}

export function orderSidebarItems(items, pinnedRoutes) {
    const indexByRoute = new Map(pinnedRoutes.map((route, index) => [route, index]));
    return items
        .filter((item) => indexByRoute.has(item.to))
        .sort((left, right) => indexByRoute.get(left.to) - indexByRoute.get(right.to));
}
