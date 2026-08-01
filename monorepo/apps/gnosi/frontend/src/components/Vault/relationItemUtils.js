export const RELATION_UNLINKED_EVENT = 'gnosi:relation-unlinked';
export const RELATION_VALUE_APPLIED_EVENT = 'gnosi:relation-value-applied';

export function normalizeRelationValues(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item ?? '').trim()).filter(Boolean);
    }
    if (value === undefined || value === null || value === '') return [];
    return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

export function withoutRelationValue(value, relationId) {
    const target = String(relationId ?? '').trim();
    return normalizeRelationValues(value).filter(item => item !== target);
}

export function announceRelationUnlinked({
    pageId,
    field,
    metadataKey,
    relationId,
    relationTitle,
    previousValue,
    nextValue,
}) {
    if (!pageId || !metadataKey || typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(RELATION_UNLINKED_EVENT, {
        detail: {
            pageId,
            field: field || metadataKey,
            metadataKey,
            relationId,
            relationTitle: relationTitle || relationId,
            previousValue: normalizeRelationValues(previousValue),
            nextValue: normalizeRelationValues(nextValue),
        },
    }));
}

export async function unlinkRelationFromRecord({
    pageId,
    field,
    metadataKey,
    value,
    relationId,
    relationTitle,
    onUpdate,
}) {
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
