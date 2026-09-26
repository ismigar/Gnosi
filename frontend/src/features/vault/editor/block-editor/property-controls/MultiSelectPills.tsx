import { MultiSelectPills as SharedMultiSelectPills } from '../../../../../shared/ui/selection/MultiSelectPills';
import { readPropertyValues, propertyKey } from './values';
import { RelationItem } from '../../../properties/RelationItem';
import type { MultiSelectPillsProps } from './types';

export function MultiSelectPills({ relationItems, onOpenRelation, onRemoveRelation, ...props }: MultiSelectPillsProps) {
    // Keep the editor's relation behavior outside the shared selection control.
    readPropertyValues(props.value);
    return <SharedMultiSelectPills {...props} renderValue={relationItems ? value => (
        <RelationItem relationId={propertyKey(value)} title={props.idToTitle[propertyKey(value)] || value}
            onOpen={onOpenRelation ?? undefined}
            onRemove={onRemoveRelation ? async id => { await onRemoveRelation(id); } : undefined} />
    ) : undefined} />;
}
