import {
    File as FileIcon,
    FileText,
    Film,
    Image as ImageIcon,
    Music,
    type LucideIcon,
} from 'lucide-react';


interface MediaKindIconProps {
    readonly kind: string;
    readonly size?: number;
}


const KIND_ICONS: Readonly<Record<string, LucideIcon>> = {
    audio: Music,
    image: ImageIcon,
    pdf: FileText,
    video: Film,
};


export function MediaKindIcon({ kind, size = 14 }: MediaKindIconProps) {
    const Icon = KIND_ICONS[kind] ?? FileIcon;
    return (
        <Icon
            className="shrink-0 text-[var(--text-tertiary)]"
            size={size}
        />
    );
}
