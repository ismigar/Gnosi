import type { ReactNode, RefObject } from 'react';

/** Preserve scalar types decoded from legacy JSON instead of stringifying saves. */
export type PropertyScalar = string | number | boolean | null;
export type PropertySelection = PropertyScalar | PropertyScalar[];
export type PropertyTitles = Readonly<Record<string, PropertyScalar | undefined>>;

export interface PropertyDropdownPortalProps {
    readonly zIndex?: string;
    readonly anchorRef: RefObject<HTMLElement | null>;
    readonly children: ReactNode;
}

export interface MultiSelectPillsProps {
    readonly portalZIndex?: string;
    readonly label?: string;
    readonly emptyMessage?: string;
    readonly unavailableLabel?: string;
    readonly disabled?: boolean;
    readonly minimum?: number;
    readonly renderValue?: (value: PropertyScalar) => ReactNode;
    readonly value?: unknown;
    readonly onChange: (value: PropertySelection) => void;
    readonly options?: readonly unknown[] | null;
    readonly idToTitle: PropertyTitles;
    readonly placeholder?: string;
    readonly onCreate?: (value: string) => void;
    readonly onDeleteOption?: (value: string) => void;
    readonly single?: boolean;
}

export interface SingleSelectPillProps {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly options?: readonly string[] | null;
    readonly idToTitle: PropertyTitles;
    readonly placeholder?: string;
}
