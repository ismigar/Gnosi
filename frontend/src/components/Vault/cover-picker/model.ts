import type { CoverGroup } from './types';


export const PREDEFINED_COVER_GROUPS: readonly CoverGroup[] = [
    {
        images: [
            'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?q=80&w=2070&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1557672172-298e090bd0f1?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1557682250-33bd709cbe85?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop',
        ],
        labelKey: 'cover_picker.groups.colors',
        name: 'Colors i Degradats',
    },
    {
        images: [
            'https://images.unsplash.com/photo-1614730321146-b6fa6a46bcb4?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1464802686167-b939a6910659?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=80&w=1000&auto=format&fit=crop',
        ],
        labelKey: 'cover_picker.groups.nature',
        name: 'Espai i Natura',
    },
    {
        images: [
            'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1513694203232-719a280e022f?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1518640467707-6811f4a6ab73?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1506815340623-ac72147171d7?q=80&w=1000&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=1000&auto=format&fit=crop',
        ],
        labelKey: 'cover_picker.groups.architecture',
        name: 'Arquitectura i Textures',
    },
];


export interface CoverPickerPosition {
    readonly right: number;
    readonly top: number;
}


export interface CoverPickerAnchorRect {
    readonly bottom: number;
    readonly right: number;
}


export function calculateCoverPickerPosition(
    anchorRect: CoverPickerAnchorRect | null | undefined,
    viewportWidth: number,
): CoverPickerPosition {
    if (!anchorRect) return { right: 20, top: 60 };
    return {
        right: viewportWidth - anchorRect.right,
        top: anchorRect.bottom + 8,
    };
}
