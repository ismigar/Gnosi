import { MultiSelectPills as SharedMultiSelectPills } from '../../../../../shared/ui/selection/MultiSelectPills';
import { readPropertyValues, propertyKey } from './values';
import { RelationItem } from '../../../properties/RelationItem';
import type { MultiSelectPillsProps } from './types';

export function MultiSelectPills({ relationItems, onOpenRelation, onRemoveRelation, ...props }: MultiSelectPillsProps) {
    // Keep the editor's relation behavior outside the shared selection control.
    const values = readPropertyValues(props.value);
    // A locked relation can still be opened. Putting its link inside a
    // disabled combobox would also mark the navigation button as disabled.
    if (relationItems && props.disabled) return <div className="flex flex-wrap gap-1.5 px-2 py-1 min-w-0">
        {values.length ? values.map(value => <RelationItem key={propertyKey(value)} relationId={propertyKey(value)}
            title={props.idToTitle[propertyKey(value)] || value} onOpen={onOpenRelation ?? undefined} />)
            : <span className="text-sm text-[var(--text-tertiary)]">{props.placeholder}</span>}
    </div>;
    return <SharedMultiSelectPills {...props} renderValue={relationItems ? value => (
        <RelationItem relationId={propertyKey(value)} title={props.idToTitle[propertyKey(value)] || value}
            onOpen={onOpenRelation ?? undefined}
            onRemove={onRemoveRelation ? async id => { await onRemoveRelation(id); } : undefined} />
    ) : undefined} />;
}
