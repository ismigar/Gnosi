import { emitAppEvent } from '../../shared/platform/app-events';

export const RELATION_UNLINKED_EVENT = 'gnosi:relation-unlinked';
export const RELATION_VALUE_APPLIED_EVENT = 'gnosi:relation-value-applied';

type RelationScalar =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

type RelationInput = RelationScalar | readonly RelationScalar[];

interface RelationEventInput {
  field?: string | null;
  metadataKey?: string | null;
  nextValue?: RelationInput;
  pageId?: string | null;
  previousValue?: RelationInput;
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
  value?: RelationInput;
}

function isRelationArray(
  value: RelationInput,
): value is readonly RelationScalar[] {
  return Array.isArray(value);
}

export function normalizeRelationValues(value?: RelationInput): string[] {
  if (isRelationArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
  }
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function withoutRelationValue(
  value: RelationInput,
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
