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
  name?: string | null;
  order?: number | null;
  table_id?: ViewKey;
}

export const VIEW_TYPES: ViewTypeDefinition[] = [
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
  MAIN_VIEW_NAME,
  'Taula Principal',
]);

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

export const isProtectedMainView = (
  view?: VaultView | null,
): boolean =>
  view?.id === 'default' ||
  view?.is_main === true ||
  view?.is_default === true ||
  isLockedView(view) ||
  LEGACY_MAIN_VIEW_NAMES.has(view?.name ?? '');

export const isMainView = (
  view?: VaultView | null,
  tableViews: unknown = [],
): boolean => {
  if (!view) return false;

  const safeTableViews = isViewArray(tableViews)
    ? tableViews.filter(isPresentView)
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
    LEGACY_MAIN_VIEW_NAMES.has(candidate.name ?? ''),
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
