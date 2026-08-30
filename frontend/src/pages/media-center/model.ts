import type {MediaItem, MediaPageQuery, MediaView} from '../../shared/api/media-browser';
export type MediaAsset = MediaItem & {lat?: number | null; lng?: number | null};
export type MediaLayout = 'grid' | 'list';
export type MediaFilters = {kinds: string[]; q: string; tagsAny: string[]; datePreset: string; mtimeFrom: string; mtimeTo: string; sizePreset: string; [key: string]: unknown};
export type MediaSort = {field: string; dir: string; [key: string]: unknown};
export type MediaMetadata = Pick<MediaItem, 'tags' | 'description'>;
export const DEFAULT_FILTERS: Readonly<MediaFilters> = Object.freeze({kinds: [],q: '',tagsAny: [],datePreset: 'all',mtimeFrom: '',mtimeTo: '',sizePreset: 'all'});
export const DEFAULT_SORT: Readonly<MediaSort> = Object.freeze({field: 'mtime',dir: 'desc'});
export const PAGE_SIZE = 50;

export function normalizeUrl(url: string) {
  if (!url) return '';
  const match = /^https?:\/\/[^/]+(\/api\/.*)$/i.exec(url);
  return match?.[1] ?? url;
}
export function isoDaysAgo(days: number) {
 const date = new Date(); date.setDate(date.getDate() - days);
 return date.toISOString().slice(0, 10);
}
export function viewFilters(view: MediaView): MediaFilters {
 const filters = {...DEFAULT_FILTERS, ...view.filters};
 return {...filters,
   kinds: filters.kinds.filter((value): value is string => typeof value === 'string'),
   tagsAny: filters.tagsAny.filter((value): value is string => typeof value === 'string'),
 };
}
export function mediaQuery(root: string, album: string, offset: number, filters: MediaFilters, sort: MediaSort): MediaPageQuery {
 const params: MediaPageQuery = {limit: PAGE_SIZE, offset, root};
 if (album) params.album = album;
 if (filters.kinds.length) params.kinds = filters.kinds.join(',');
 if (filters.q.trim()) params.q = filters.q.trim();
 if (filters.tagsAny.length) params.tags_any = filters.tagsAny.join(',');
 if (filters.mtimeFrom) params.mtime_from = filters.mtimeFrom;
 if (filters.mtimeTo) params.mtime_to = filters.mtimeTo;
 if (filters.sizePreset === 'small') params.size_max = 500;
 if (filters.sizePreset === 'medium') {params.size_min = 500; params.size_max = 5120;}
 if (filters.sizePreset === 'large') params.size_min = 5120;
 if (sort.field !== 'mtime' || sort.dir !== 'desc') {params.sort = sort.field; params.dir = sort.dir;}
 return params;
}
