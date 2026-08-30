import type { TFunction } from 'i18next';

import {
  defineStorageKey,
  jsonStorageCodec,
  readStorage,
  stringStorageCodec,
  writeStorage,
} from '../../shared/platform/browser-storage';
import type { VaultSchema } from './schemaTypes';
import { getFieldType, getSchemaFieldNames } from './schemaUtils';
import { isMainView } from './viewConstants';
import type {
  VaultFeedActiveView,
  VaultFeedNote,
} from './vaultFeedTypes';


const FEED_PANE_WIDTH_KEY = defineStorageKey(
  'gnosi.feed.readingPaneWidth',
  stringStorageCodec,
);
const FEED_DOCK_KEY = defineStorageKey(
  'gnosi.feed.dockReadingPane',
  stringStorageCodec,
);


function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}


export function feedValueString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number'
    || typeof value === 'bigint'
    || typeof value === 'boolean'
  ) {
    return String(value);
  }
  return '';
}


function feedViewId(activeView: VaultFeedActiveView): string {
  return typeof activeView.id === 'string' && activeView.id
    ? activeView.id
    : 'default';
}


function readIdsKey(activeView: VaultFeedActiveView) {
  return defineStorageKey(
    `gnosi.feed.read.${feedViewId(activeView)}`,
    jsonStorageCodec<readonly string[]>(isStringArray),
  );
}


function lastRecordKey(activeView: VaultFeedActiveView) {
  return defineStorageKey(
    `gnosi.feed.lastRecord.${feedViewId(activeView)}`,
    stringStorageCodec,
  );
}


export function prepareFeedBody(raw: unknown): string {
  if (!raw) return '';
  return feedValueString(raw)
    .replace(/<file\b[^>]*(?:>|$)/gi, '')
    .replace(/<\/file>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();
}


export interface FeedHighlightPart {
  readonly highlighted: boolean;
  readonly text: string;
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


export function splitFeedHighlight(
  value: unknown,
  searchTerm: string,
): FeedHighlightPart[] {
  const text = feedValueString(value);
  const terms = searchTerm.trim().split(/\s+/).filter((term) => term.length > 1);
  if (terms.length === 0) return [{ highlighted: false, text }];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'ig');
  return text.split(pattern).filter(Boolean).map((part) => ({
    highlighted: terms.some(
      (term) => part.toLocaleLowerCase() === term.toLocaleLowerCase(),
    ),
    text: part,
  }));
}


function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}


function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}


export function resolveVaultFeedSettings(activeView: VaultFeedActiveView) {
  return {
    excerptLines: positiveNumber(
      activeView.excerptLines ?? activeView.excerpt_lines,
      6,
    ),
    feedFocus: Boolean(activeView.feedFocus ?? activeView.feed_focus),
    pillLimit: positiveNumber(activeView.pillLimit ?? activeView.pill_limit, 5),
    summaryModel: optionalString(
      activeView.summaryModel ?? activeView.summary_model,
    ),
  };
}


export function visibleFeedColumns(
  schema: VaultSchema,
  activeView: VaultFeedActiveView,
): ReadonlyArray<readonly [string, string]> {
  const configured = activeView.visibleProperties
    ?? activeView.visible_properties
    ?? activeView.columns;
  const fieldNames = getSchemaFieldNames(schema);
  const properties = Array.isArray(configured) && configured.length > 0
    ? configured
    : isMainView(activeView) ? fieldNames : fieldNames.slice(0, 3);
  return properties
    .map((property: unknown) => {
      if (typeof property === 'string') return property;
      if (!property || typeof property !== 'object' || Array.isArray(property)) {
        return '';
      }
      const fieldKey = (property as Readonly<Record<string, unknown>>).fieldKey;
      return typeof fieldKey === 'string' ? fieldKey : '';
    })
    .filter(Boolean)
    .map((field) => [field, getFieldType(schema, field)] as const)
    .filter(([field, type]) => (
      Boolean(type)
      && type !== 'title'
      && field.toLocaleLowerCase() !== 'title'
    ));
}


export function feedDateGroup(
  value: unknown,
  locale: string,
  t: TFunction,
  now = new Date(),
): string {
  const date = new Date(feedValueString(value));
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startWeek = new Date(startToday);
  startWeek.setDate(startToday.getDate() - ((startToday.getDay() + 6) % 7));
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (date >= startToday) return t('feed.group_today');
  if (date >= startWeek) return t('feed.group_this_week');
  if (date >= startMonth) return t('feed.group_this_month');
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}


export function readFeedPaneWidth(): number {
  return positiveNumber(readStorage(FEED_PANE_WIDTH_KEY), 480);
}


export function writeFeedPaneWidth(width: number): void {
  writeStorage(FEED_PANE_WIDTH_KEY, String(width));
}


export function readFeedDocked(): boolean {
  return readStorage(FEED_DOCK_KEY) === 'true';
}


export function writeFeedDocked(value: boolean): void {
  writeStorage(FEED_DOCK_KEY, String(value));
}


export function readFeedReadIds(activeView: VaultFeedActiveView): Set<string> {
  return new Set(readStorage(readIdsKey(activeView)) ?? []);
}


export function writeFeedReadIds(
  activeView: VaultFeedActiveView,
  ids: ReadonlySet<string>,
): void {
  writeStorage(readIdsKey(activeView), [...ids].slice(-500));
}


export function readLastFeedRecord(activeView: VaultFeedActiveView): string {
  return readStorage(lastRecordKey(activeView)) ?? '';
}


export function writeLastFeedRecord(
  activeView: VaultFeedActiveView,
  id: string,
): void {
  writeStorage(lastRecordKey(activeView), id);
}


export function feedNoteTitle(note: VaultFeedNote): string {
  return typeof note.title === 'string' ? note.title : '';
}


export function feedMetadataValue(
  note: VaultFeedNote,
  key: string,
): import('../../utils/vaultFilters').FilterValue {
  return note.metadata?.[key];
}


export function feedMetadataString(
  note: VaultFeedNote,
  key: string,
): string {
  return feedValueString(feedMetadataValue(note, key));
}


export function feedModifiedDate(note: VaultFeedNote): Date {
  return new Date(feedValueString(note.last_modified));
}
