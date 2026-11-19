import {
  BarChart3,
  Calendar,
  CalendarRange,
  Columns2,
  LayoutGrid,
  List,
  Newspaper,
  Share2,
  Table,
  Users,
  type LucideIcon,
} from 'lucide-react';

interface ViewTypeDefinition {
  icon: LucideIcon;
  id: string;
  label: string;
}

type ViewKey = string | number | null | undefined;

interface ViewFilter {
  value?: unknown;
}

interface VaultView {
  [key: string]: unknown;
  embedded?: unknown;
  filters?: unknown;
  hidden?: unknown;
  id?: ViewKey;
  isLocked?: unknown;
  is_default?: unknown;
  is_locked?: unknown;
  is_main?: unknown;
  locked?: unknown;
  name?: unknown;
  order?: number | null;
  table_id?: ViewKey;
}

export const VIEW_TYPES: ViewTypeDefinition[] = [
  { id: 'genogram', label: 'Genogram', icon: Users },
  { id: 'table', label: 'Table', icon: Table },
  { id: 'board', label: 'Kanban', icon: Columns2 },
  { id: 'gallery', label: 'Gallery', icon: LayoutGrid },
  { id: 'list', label: 'List', icon: List },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'timeline', label: 'Timeline', icon: CalendarRange },
  { id: 'feed', label: 'Feed', icon: Newspaper },
  { id: 'chart', label: 'Chart', icon: BarChart3 },
  { id: 'graph', label: 'Graph', icon: Share2 },
];

export const MAIN_VIEW_NAME = 'Main Table';
const LEGACY_MAIN_VIEW_NAMES = new Set([
  'main table',
  'taula principal',
  'vista principal',
  'tableau principal',
]);

function hasLegacyMainViewName(name: unknown): boolean {
  return typeof name === 'string' && LEGACY_MAIN_VIEW_NAMES.has(name.trim().toLowerCase());
}

function isViewArray(
  value: unknown,
): value is readonly (VaultView | null | undefined)[] {
  return Array.isArray(value);
}

function isViewFilterArray(value: unknown): value is readonly ViewFilter[] {
  return Array.isArray(value);
}

function isPresentView(
  view: VaultView | null | undefined,
): view is VaultView {
  return Boolean(view);
}

export const isLockedView = (view?: VaultView | null): boolean =>
  Boolean(view?.locked || view?.is_locked || view?.isLocked);

// The page editor explicitly identifies the custom views it creates, whether
// or not the user also displays them as table tabs.
const isCustomPageView = (view?: VaultView | null): boolean =>
  view?.is_main === false && typeof view.embedded === 'boolean';

export const isProtectedMainView = (
  view?: VaultView | null,
): boolean =>
  view?.id === 'default' ||
  view?.is_main === true ||
  view?.is_default === true ||
  isLockedView(view) ||
  (!isCustomPageView(view) && hasLegacyMainViewName(view?.name));

export const canBeMainView = (view: VaultView): boolean =>
  isProtectedMainView(view) || (!isCustomPageView(view) && !(view.embedded === true && view.hidden === true));

export const isMainView = (
  view?: VaultView | null,
  tableViews: unknown = [],
): boolean => {
  if (!view || !canBeMainView(view)) return false;

  const safeTableViews = isViewArray(tableViews)
    ? tableViews.filter(isPresentView).filter(canBeMainView)
    : [];

  if (safeTableViews.length === 0) {
    return isProtectedMainView(view);
  }

  const scopedViews = view.table_id
    ? safeTableViews.filter(
        (candidate) => (candidate.table_id || null) === view.table_id,
      )
    : safeTableViews;
  const candidateViews =
    scopedViews.length > 0 ? scopedViews : safeTableViews;

  const nonEmbedCandidates = candidateViews.filter(
    (candidate) => !isPageEmbedView(candidate),
  );
  const effectiveCandidates =
    nonEmbedCandidates.length > 0
      ? nonEmbedCandidates
      : candidateViews;

  const explicitMain = effectiveCandidates.find(isProtectedMainView);
  if (explicitMain) return explicitMain.id === view.id;

  const mainByName = effectiveCandidates.find((candidate) =>
    hasLegacyMainViewName(candidate.name),
  );
  if (mainByName) return mainByName.id === view.id;

  const ordered = [...effectiveCandidates].sort(
    (left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) -
      (right.order ?? Number.MAX_SAFE_INTEGER),
  );
  return ordered.at(0)?.id === view.id;
};

export const getViewIcon = (typeId?: string | null): LucideIcon => {
  const view = VIEW_TYPES.find((candidate) => candidate.id === typeId);
  return view ? view.icon : Table;
};

export const isViewHidden = (
  view?: VaultView | null,
  tableViews: unknown = [],
): boolean => {
  if (isMainView(view, tableViews)) return false;
  if (typeof view?.hidden === 'boolean') return view.hidden;
  if (isPageEmbedView(view)) return true;
  return false;
};

export const isPageEmbedView = (
  view?: VaultView | null,
): boolean => {
  if (!view) return false;
  if (view.embedded === false) return false;
  const filters = isViewFilterArray(view.filters) ? view.filters : [];
  if (filters.some((filter) => filter.value === 'this')) {
    return true;
  }
  return false;
};
