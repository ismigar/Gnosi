import { emitAppEvent } from '../../../shared/platform/app-events';

export const RELATION_UNLINKED_EVENT = 'gnosi:relation-unlinked';
export const RELATION_VALUE_APPLIED_EVENT = 'gnosi:relation-value-applied';

type RelationScalar =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

interface RelationEventInput {
  field?: string | null;
  metadataKey?: string | null;
  nextValue?: unknown;
  pageId?: string | null;
  previousValue?: unknown;
  relationId?: RelationScalar;
  relationTitle?: RelationScalar;
}

interface RelationPatch {
  metadata: Record<string, string[]>;
}

interface UnlinkRelationInput extends RelationEventInput {
  onUpdate?:
    | ((pageId: string, patch: RelationPatch) => unknown)
    | null;
  value?: unknown;
}

function isRelationArray(
  value: unknown,
): value is readonly unknown[] {
  return Array.isArray(value);
}

// Legacy relation values stringify objects and nested arrays without flattening.
function relationValueText(value: unknown): string {
  return String(value);
}

export function normalizeRelationValues(value?: unknown): string[] {
  if (isRelationArray(value)) {
    return value
      .map((item) => relationValueText(item ?? '').trim())
      .filter(Boolean);
  }
  if (value === undefined || value === null || value === '') return [];
  return relationValueText(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function withoutRelationValue(
  value: unknown,
  relationId?: RelationScalar,
): string[] {
  const target = String(relationId ?? '').trim();
  return normalizeRelationValues(value).filter((item) => item !== target);
}

export function announceRelationUnlinked({
  pageId,
  field,
  metadataKey,
  relationId,
  relationTitle,
  previousValue,
  nextValue,
}: RelationEventInput): void {
  if (!pageId || !metadataKey) return;
  emitAppEvent(RELATION_UNLINKED_EVENT, {
    pageId,
    field: field || metadataKey,
    metadataKey,
    relationId,
    relationTitle: relationTitle || relationId,
    previousValue: normalizeRelationValues(previousValue),
    nextValue: normalizeRelationValues(nextValue),
  });
}

export async function unlinkRelationFromRecord({
  pageId,
  field,
  metadataKey,
  value,
  relationId,
  relationTitle,
  onUpdate,
}: UnlinkRelationInput): Promise<boolean> {
  if (!pageId || !metadataKey || !onUpdate) return false;
  const previousValue = normalizeRelationValues(value);
  const nextValue = withoutRelationValue(previousValue, relationId);
  if (nextValue.length === previousValue.length) return false;

  await onUpdate(pageId, { metadata: { [metadataKey]: nextValue } });
  announceRelationUnlinked({
    pageId,
    field,
    metadataKey,
    relationId,
    relationTitle,
    previousValue,
    nextValue,
  });
  return true;
}
