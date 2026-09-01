import type { ReactNode, RefObject } from 'react';

/** Preserve scalar types decoded from legacy JSON instead of stringifying saves. */
export type PropertyScalar = string | number | boolean | null;
export type PropertySelection = PropertyScalar | PropertyScalar[];
export type PropertyTitles = Readonly<Record<string, PropertyScalar | undefined>>;

export interface PropertyDropdownPortalProps {
    readonly anchorRef: RefObject<HTMLElement | null>;
    readonly children: ReactNode;
}

export interface MultiSelectPillsProps {
    readonly value?: unknown;
    readonly onChange: (value: PropertySelection) => void;
    readonly options?: readonly unknown[] | null;
    readonly idToTitle: PropertyTitles;
    readonly placeholder?: string;
    readonly onCreate?: (value: string) => void;
    readonly onDeleteOption?: (value: string) => void;
    readonly single?: boolean;
    readonly relationItems?: boolean;
    readonly onOpenRelation?: ((id: string) => void) | null;
    readonly onRemoveRelation?: ((id: string) => unknown) | null;
}

export interface SingleSelectPillProps {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly options?: readonly string[] | null;
    readonly idToTitle: PropertyTitles;
    readonly placeholder?: string;
}
